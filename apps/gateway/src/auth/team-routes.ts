import { and, desc, eq, gt, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { createDatabase } from "../db/client.ts";
import { apiTokens, deviceAuthorizations, teamMemberships, teamSlugChangeLocks, teamSlugs, teams, user } from "../db/schema.ts";
import { requireBrowserIdentity } from "./identity.ts";
import { authError, noStoreHeaders } from "./middleware.ts";
import { safePermissions } from "./permissions.ts";
import { isValidTeamSlug, TEAM_SLUG_CHANGE_COOLDOWN_MS } from "./team-slug.ts";
import type { GatewayEnv } from "./types.ts";
import type { WebIdentity } from "./web-session.ts";

type TeamRole = "owner" | "admin" | "member";

type TeamContext = {
  teamId: string;
  name: string;
  slug: string;
  role: TeamRole;
};

type Cursor = { createdAt: Date; id: string };

export async function handleTeam(request: Request, env: GatewayEnv, teamId: string): Promise<Response> {
  const identity = await requireBrowserIdentity(request, env);
  if (identity instanceof Response) return identity;
  const db = createDatabase(env.DB);
  const team = await findTeamContext(db, identity.id, teamId);
  if (!team) return authError(404, "team_not_found");

  if (request.method === "GET") return teamDetailsResponse(db, team, new Date());
  if (request.method !== "PATCH") return authError(400, "invalid_request");

  const body = await readJson(request);
  if (!isObject(body) || typeof body.slug !== "string") return authError(400, "invalid_request");
  const slug = body.slug.trim();
  if (!isValidTeamSlug(slug)) return authError(400, "invalid_team_slug");
  if (team.role !== "owner") return authError(403, "team_owner_required");
  if (slug === team.slug) return teamDetailsResponse(db, team, new Date());

  const now = new Date();
  const [taken] = await db.select({ teamId: teamSlugs.teamId })
    .from(teamSlugs)
    .where(eq(teamSlugs.slug, slug))
    .limit(1);
  if (taken) return authError(409, "team_slug_taken");

  try {
    const result = await changeTeamSlug(env, teamId, identity.id, slug, now);
    if (result.cooldown) {
      return Response.json({
        error: "team_slug_change_cooldown",
        nextAvailableAt: result.nextAvailableAt.toISOString(),
      }, { status: 429, headers: noStoreHeaders() });
    }
  } catch {
    const [conflict] = await db.select({ teamId: teamSlugs.teamId })
      .from(teamSlugs)
      .where(eq(teamSlugs.slug, slug))
      .limit(1);
    return conflict ? authError(409, "team_slug_taken") : authError(503, "identity_service_unavailable");
  }

  return teamDetailsResponse(db, { ...team, slug }, now);
}

export async function handleTeamApiTokens(request: Request, env: GatewayEnv, teamId: string): Promise<Response> {
  if (request.method !== "GET") return authError(400, "invalid_request");
  const identity = await requireBrowserIdentity(request, env);
  if (identity instanceof Response) return identity;
  const db = createDatabase(env.DB);
  const team = await findTeamContext(db, identity.id, teamId);
  if (!team) return authError(404, "team_not_found");

  const url = new URL(request.url);
  const limit = readLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.has("cursor") && !cursor) return authError(400, "invalid_cursor");
  const conditions = [eq(apiTokens.teamId, teamId)];
  if (team.role === "member") conditions.push(eq(apiTokens.userId, identity.id));
  if (cursor) conditions.push(cursorCondition(cursor, apiTokens.createdAt, apiTokens.id));

  const rows = await db.select({
    id: apiTokens.id,
    name: apiTokens.name,
    ownerId: user.id,
    ownerName: user.name,
    ownerEmail: user.email,
    permissions: apiTokens.permissions,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
    idleExpiresAt: apiTokens.idleExpiresAt,
    expiresAt: apiTokens.expiresAt,
    revokedAt: apiTokens.revokedAt,
  })
    .from(apiTokens)
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return Response.json({
    tokens: page.map((row) => ({
      id: row.id,
      name: row.name,
      owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail },
      permissions: safePermissions(row.permissions),
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      idleExpiresAt: row.idleExpiresAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!.createdAt, page.at(-1)!.id) : null,
  }, { headers: noStoreHeaders() });
}

export async function handleTeamDevices(request: Request, env: GatewayEnv, teamId: string): Promise<Response> {
  if (request.method !== "GET") return authError(400, "invalid_request");
  const identity = await requireBrowserIdentity(request, env);
  if (identity instanceof Response) return identity;
  const db = createDatabase(env.DB);
  const team = await findTeamContext(db, identity.id, teamId);
  if (!team) return authError(404, "team_not_found");

  const url = new URL(request.url);
  const limit = readLimit(url.searchParams.get("limit"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.has("cursor") && !cursor) return authError(400, "invalid_cursor");
  const now = new Date();
  const conditions = [
    eq(deviceAuthorizations.teamId, teamId),
    eq(deviceAuthorizations.status, "completed"),
    isNotNull(deviceAuthorizations.apiTokenId),
    isNull(apiTokens.revokedAt),
    gt(apiTokens.expiresAt, now),
    gt(apiTokens.idleExpiresAt, now),
  ];
  if (team.role === "member") conditions.push(eq(apiTokens.userId, identity.id));
  if (cursor) conditions.push(cursorCondition(cursor, apiTokens.createdAt, apiTokens.id));

  const rows = await db.select({
    id: deviceAuthorizations.id,
    tokenId: apiTokens.id,
    name: deviceAuthorizations.deviceName,
    platform: deviceAuthorizations.platform,
    clientVersion: deviceAuthorizations.clientVersion,
    ownerId: user.id,
    ownerName: user.name,
    ownerEmail: user.email,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
    expiresAt: apiTokens.expiresAt,
    revokedAt: apiTokens.revokedAt,
  })
    .from(deviceAuthorizations)
    .innerJoin(apiTokens, eq(deviceAuthorizations.apiTokenId, apiTokens.id))
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return Response.json({
    devices: page.map((row) => ({
      id: row.id,
      tokenId: row.tokenId,
      name: row.name || "Artifact Sync device",
      platform: row.platform,
      clientVersion: row.clientVersion,
      owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail },
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!.createdAt, page.at(-1)!.id) : null,
  }, { headers: noStoreHeaders() });
}

export async function canManageApiToken(
  db: ReturnType<typeof createDatabase>,
  identity: WebIdentity,
  token: { userId: string; teamId: string },
): Promise<boolean> {
  if (token.userId === identity.id) return true;
  const membership = await findTeamContext(db, identity.id, token.teamId);
  return membership?.role === "owner" || membership?.role === "admin";
}

async function changeTeamSlug(
  env: GatewayEnv,
  teamId: string,
  userId: string,
  slug: string,
  now: Date,
): Promise<{ cooldown: false } | { cooldown: true; nextAvailableAt: Date }> {
  const claimId = crypto.randomUUID();
  const nowMilliseconds = now.getTime();
  const cutoff = nowMilliseconds - TEAM_SLUG_CHANGE_COOLDOWN_MS;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO team_slug_change_locks (team_id, last_changed_at, claim_id)
      VALUES (?, ?, ?)
      ON CONFLICT(team_id) DO UPDATE SET
        last_changed_at = excluded.last_changed_at,
        claim_id = excluded.claim_id
      WHERE team_slug_change_locks.last_changed_at <= ?
    `).bind(teamId, nowMilliseconds, claimId, cutoff),
    env.DB.prepare(`
      UPDATE teams
      SET slug = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM team_slug_change_locks
        WHERE team_id = ? AND claim_id = ?
      )
    `).bind(slug, teamId, teamId, claimId),
    env.DB.prepare(`
      UPDATE team_slugs
      SET is_current = 0
      WHERE team_id = ? AND is_current = 1 AND EXISTS (
        SELECT 1 FROM team_slug_change_locks
        WHERE team_id = ? AND claim_id = ?
      )
    `).bind(teamId, teamId, claimId),
    env.DB.prepare(`
      INSERT INTO team_slugs (
        slug, team_id, is_current, created_at, changed_at, changed_by_user_id
      )
      SELECT ?, ?, 1, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM team_slug_change_locks
        WHERE team_id = ? AND claim_id = ?
      )
    `).bind(slug, teamId, nowMilliseconds, nowMilliseconds, userId, teamId, claimId),
    env.DB.prepare(`
      UPDATE team_slug_change_locks
      SET claim_id = NULL
      WHERE team_id = ? AND claim_id = ?
    `).bind(teamId, claimId),
  ]);

  const db = createDatabase(env.DB);
  const [current] = await db.select({ slug: teams.slug })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  const [registry] = await db.select({ slug: teamSlugs.slug, isCurrent: teamSlugs.isCurrent })
    .from(teamSlugs)
    .where(and(
      eq(teamSlugs.teamId, teamId),
      eq(teamSlugs.slug, slug),
      eq(teamSlugs.isCurrent, true),
    ))
    .limit(1);
  if (current?.slug === slug && registry) return { cooldown: false };

  const [lock] = await db.select({ lastChangedAt: teamSlugChangeLocks.lastChangedAt })
    .from(teamSlugChangeLocks)
    .where(eq(teamSlugChangeLocks.teamId, teamId))
    .limit(1);
  if (lock && lock.lastChangedAt.getTime() > cutoff) {
    return {
      cooldown: true,
      nextAvailableAt: new Date(lock.lastChangedAt.getTime() + TEAM_SLUG_CHANGE_COOLDOWN_MS),
    };
  }
  throw new Error("team slug change did not apply");
}

async function findTeamContext(
  db: ReturnType<typeof createDatabase>,
  userId: string,
  teamId: string,
): Promise<TeamContext | undefined> {
  const [team] = await db.select({
    teamId: teams.id,
    name: teams.name,
    slug: teams.slug,
    role: teamMemberships.role,
  })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .where(and(eq(teamMemberships.userId, userId), eq(teams.id, teamId)))
    .limit(1);
  return team;
}

async function teamDetailsResponse(
  db: ReturnType<typeof createDatabase>,
  team: TeamContext,
  now: Date,
): Promise<Response> {
  const history = await db.select({
    slug: teamSlugs.slug,
    isCurrent: teamSlugs.isCurrent,
    changedAt: teamSlugs.changedAt,
    changedByName: user.name,
  })
    .from(teamSlugs)
    .leftJoin(user, eq(teamSlugs.changedByUserId, user.id))
    .where(eq(teamSlugs.teamId, team.teamId))
    .orderBy(desc(teamSlugs.changedAt), desc(teamSlugs.slug));
  const [lock] = await db.select({ lastChangedAt: teamSlugChangeLocks.lastChangedAt })
    .from(teamSlugChangeLocks)
    .where(eq(teamSlugChangeLocks.teamId, team.teamId))
    .limit(1);
  const nextAvailableAt = lock
    ? new Date(lock.lastChangedAt.getTime() + TEAM_SLUG_CHANGE_COOLDOWN_MS)
    : null;
  return Response.json({
    team: {
      id: team.teamId,
      name: team.name,
      slug: team.slug,
      role: team.role,
    },
    slugHistory: history.map((entry) => ({
      slug: entry.slug,
      isCurrent: entry.isCurrent,
      changedAt: entry.changedAt?.toISOString() ?? null,
      changedByName: entry.changedByName,
    })),
    slugChange: {
      canChange: team.role === "owner" && (!nextAvailableAt || nextAvailableAt.getTime() <= now.getTime()),
      nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
    },
  }, { headers: noStoreHeaders() });
}

function readLimit(value: string | null): number {
  const parsed = Number(value ?? "50");
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as unknown;
    if (!isObject(decoded) || typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") return null;
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !decoded.id) return null;
    return { createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return btoa(JSON.stringify({ createdAt: createdAt.toISOString(), id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function cursorCondition(cursor: Cursor, createdAt: typeof apiTokens.createdAt, id: typeof apiTokens.id): SQL {
  const condition = or(
    lt(createdAt, cursor.createdAt),
    and(eq(createdAt, cursor.createdAt), lt(id, cursor.id)),
  );
  if (!condition) throw new Error("cursor condition could not be created");
  return condition;
}

async function readJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) return null;
  try {
    const text = await request.text();
    if (text.length > 16_384) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
