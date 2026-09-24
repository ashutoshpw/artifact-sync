import { and, count, desc, eq, gt, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { createDatabase } from "../db/client.ts";
import { apiTokens, deviceAuthorizations, teamMemberships, teamSlugChangeLocks, teamSlugs, teams, user } from "../db/schema.ts";
import { authError } from "../auth/middleware.ts";
import { safePermissions } from "../auth/permissions.ts";
import { TEAM_SLUG_CHANGE_COOLDOWN_MS } from "../auth/team-slug.ts";
import type { GatewayEnv } from "../auth/types.ts";
import { getWebIdentity, type WebIdentity } from "../auth/web-session.ts";

export type TeamRole = "owner" | "admin" | "member";
export type DashboardLayout = "sidebar" | "topnav";

export interface DashboardTeam {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
}

export interface DashboardSession {
  identity: WebIdentity;
  teams: DashboardTeam[];
  team?: DashboardTeam;
  layout: DashboardLayout;
}

export interface DashboardArtifact {
  path: string;
  size: number;
  uploadedAt: string;
  etag?: string;
}

export interface DashboardToken {
  id: string;
  name: string;
  owner: { id: string; name: string; email: string };
  permissions: string[];
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface DashboardDevice {
  id: string;
  tokenId: string;
  name: string;
  platform: string | null;
  clientVersion: string | null;
  owner: { id: string; name: string; email: string };
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface DashboardSettings {
  slugHistory: Array<{
    slug: string;
    isCurrent: boolean;
    changedAt: string | null;
    changedByName: string | null;
  }>;
  canChangeSlug: boolean;
  nextAvailableAt: string | null;
}

export interface DashboardPage<T> {
  items: T[];
  nextCursor: string | null;
}

export async function requireDashboardSession(
  request: Request,
  env: GatewayEnv,
  teamId?: string,
): Promise<DashboardSession | Response> {
  const identity = await getWebIdentity(request, env).catch(() => null);
  if (!identity) return authError(401, "web_session_required");
  const teams = await listUserTeams(identity.id, env);
  const team = teamId ? teams.find((candidate) => candidate.id === teamId) : teams[0];
  if (teamId && !team) return authError(404, "team_not_found");
  return {
    identity,
    teams,
    team,
    layout: dashboardLayout(env),
  };
}

export function dashboardLayout(env: GatewayEnv): DashboardLayout {
  return env.DASHBOARD_LAYOUT === "topnav" ? "topnav" : "sidebar";
}

export async function listUserTeams(userId: string, env: GatewayEnv): Promise<DashboardTeam[]> {
  const db = createDatabase(env.DB);
  const rows = await db.select({
    id: teams.id,
    name: teams.name,
    slug: teams.slug,
    role: teamMemberships.role,
  })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .where(eq(teamMemberships.userId, userId))
    .orderBy(teams.name);
  return rows;
}

export async function listDashboardArtifacts(
  env: GatewayEnv,
  teamId: string,
  requestedPrefix: string | null,
  cursor: string | null,
  limit = 50,
): Promise<{
  prefix: string;
  objects: DashboardArtifact[];
  nextCursor: string | null;
} | Response> {
  const prefix = safeArtifactPrefix(requestedPrefix);
  if (prefix === null) return authError(400, "invalid_artifact_prefix");
  const artifactRoot = `uploads/${teamId}/artifacts/`;
  const base = `${artifactRoot}${prefix}`;
  try {
    const result = await env.ARTIFACTS_BUCKET.list({
      prefix: base,
      cursor: cursor ?? undefined,
      limit: Math.min(Math.max(limit, 1), 1000),
    });
    return {
      prefix,
      objects: result.objects.map((object) => ({
        path: object.key.slice(artifactRoot.length),
        size: object.size,
        uploadedAt: object.uploaded.toISOString(),
        etag: object.httpEtag,
      })),
      nextCursor: result.truncated ? result.cursor ?? null : null,
    };
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
}

const RECENT_ARTIFACT_PAGE_SIZE = 1000;
const RECENT_ARTIFACT_MAX_PAGES = 5;

export interface RecentArtifacts {
  objects: DashboardArtifact[];
  scanned: number;
  truncated: boolean;
}

export async function listRecentArtifacts(
  env: GatewayEnv,
  teamId: string,
  limit = 8,
  maxScan = 1000,
): Promise<RecentArtifacts | Response> {
  const scanLimit = Math.max(maxScan, 1);
  const pageSize = Math.min(RECENT_ARTIFACT_PAGE_SIZE, scanLimit);
  const scanned: DashboardArtifact[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < RECENT_ARTIFACT_MAX_PAGES && scanned.length < scanLimit; page += 1) {
    const result = await listDashboardArtifacts(env, teamId, null, cursor, pageSize);
    if (result instanceof Response) return result;
    scanned.push(...result.objects);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  scanned.sort((left, right) => {
    const delta = Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt);
    return Number.isNaN(delta) || delta === 0 ? left.path.localeCompare(right.path) : delta;
  });
  return {
    objects: scanned.slice(0, Math.max(limit, 1)),
    scanned: scanned.length,
    truncated: cursor !== null,
  };
}

export async function listDashboardTokens(
  env: GatewayEnv,
  identity: WebIdentity,
  team: DashboardTeam,
  cursor: string | null,
  limit = 50,
): Promise<DashboardPage<DashboardToken> | Response> {
  if (!safeCursor(cursor)) return authError(400, "invalid_cursor");
  const db = createDatabase(env.DB);
  const conditions = [eq(apiTokens.teamId, team.id)];
  if (team.role === "member") conditions.push(eq(apiTokens.userId, identity.id));
  const decoded = decodeCursor(cursor);
  if (cursor && !decoded) return authError(400, "invalid_cursor");
  if (decoded) conditions.push(cursorCondition(decoded, apiTokens.createdAt, apiTokens.id));
  const rows = await db.select({
    id: apiTokens.id,
    name: apiTokens.name,
    ownerId: user.id,
    ownerName: user.name,
    ownerEmail: user.email,
    permissions: apiTokens.permissions,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
    expiresAt: apiTokens.expiresAt,
    revokedAt: apiTokens.revokedAt,
  })
    .from(apiTokens)
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      name: row.name,
      owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail },
      permissions: safePermissions(row.permissions),
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!.createdAt, page.at(-1)!.id) : null,
  };
}

export async function listDashboardDevices(
  env: GatewayEnv,
  identity: WebIdentity,
  team: DashboardTeam,
  scope: "mine" | "team",
  cursor: string | null,
  limit = 50,
): Promise<DashboardPage<DashboardDevice> | Response> {
  if (scope === "team" && team.role === "member") return authError(403, "team_access_required");
  if (!safeCursor(cursor)) return authError(400, "invalid_cursor");
  const db = createDatabase(env.DB);
  const now = new Date();
  const conditions = [
    eq(deviceAuthorizations.teamId, team.id),
    eq(deviceAuthorizations.status, "completed"),
    isNotNull(deviceAuthorizations.apiTokenId),
    isNull(apiTokens.revokedAt),
    gt(apiTokens.expiresAt, now),
    gt(apiTokens.idleExpiresAt, now),
  ];
  if (scope === "mine" || team.role === "member") conditions.push(eq(apiTokens.userId, identity.id));
  const decoded = decodeCursor(cursor);
  if (cursor && !decoded) return authError(400, "invalid_cursor");
  if (decoded) conditions.push(cursorCondition(decoded, apiTokens.createdAt, apiTokens.id));
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
  return {
    items: page.map((row) => ({
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
  };
}

export async function dashboardCounts(
  env: GatewayEnv,
  identity: WebIdentity,
  team: DashboardTeam,
): Promise<{ tokens: number; devices: number }> {
  const db = createDatabase(env.DB);
  const tokenConditions = [eq(apiTokens.teamId, team.id)];
  const now = new Date();
  const deviceConditions = [
    eq(deviceAuthorizations.teamId, team.id),
    eq(deviceAuthorizations.status, "completed"),
    isNotNull(deviceAuthorizations.apiTokenId),
    isNull(apiTokens.revokedAt),
    gt(apiTokens.expiresAt, now),
    gt(apiTokens.idleExpiresAt, now),
  ];
  if (team.role === "member") {
    tokenConditions.push(eq(apiTokens.userId, identity.id));
    deviceConditions.push(eq(apiTokens.userId, identity.id));
  }
  const [[tokenCount], [deviceCount]] = await Promise.all([
    db.select({ value: count() }).from(apiTokens).where(and(...tokenConditions)),
    db.select({ value: count() })
      .from(deviceAuthorizations)
      .innerJoin(apiTokens, eq(deviceAuthorizations.apiTokenId, apiTokens.id))
      .where(and(...deviceConditions)),
  ]);
  return { tokens: tokenCount.value, devices: deviceCount.value };
}

export async function dashboardSettings(
  env: GatewayEnv,
  team: DashboardTeam,
): Promise<DashboardSettings> {
  const db = createDatabase(env.DB);
  const [history, lock] = await Promise.all([
    db.select({
      slug: teamSlugs.slug,
      isCurrent: teamSlugs.isCurrent,
      changedAt: teamSlugs.changedAt,
      changedByName: user.name,
    })
      .from(teamSlugs)
      .leftJoin(user, eq(teamSlugs.changedByUserId, user.id))
      .where(eq(teamSlugs.teamId, team.id))
      .orderBy(desc(teamSlugs.changedAt), desc(teamSlugs.slug)),
    db.select({ lastChangedAt: teamSlugChangeLocks.lastChangedAt })
      .from(teamSlugChangeLocks)
      .where(eq(teamSlugChangeLocks.teamId, team.id))
      .limit(1),
  ]);
  const nextAvailableAt = lock[0]
    ? new Date(lock[0].lastChangedAt.getTime() + TEAM_SLUG_CHANGE_COOLDOWN_MS)
    : null;
  return {
    slugHistory: history.map((entry) => ({
      slug: entry.slug,
      isCurrent: entry.isCurrent,
      changedAt: entry.changedAt?.toISOString() ?? null,
      changedByName: entry.changedByName,
    })),
    canChangeSlug: team.role === "owner" && (!nextAvailableAt || nextAvailableAt.getTime() <= Date.now()),
    nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
  };
}

export function artifactHref(teamSlug: string, path: string): string {
  return `/${encodeURIComponent(teamSlug)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function safeArtifactPrefix(value: string | null): string | null {
  if (!value) return "";
  if (value.length > 1024 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return null;
  const normalized = value.normalize("NFC").replace(/^\/+|\/+$/gu, "");
  const parts = normalized ? normalized.split("/") : [];
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.length ? `${parts.join("/")}/` : "";
}

function safeCursor(value: string | null): boolean {
  return !value || value.length <= 1024;
}

type Cursor = { createdAt: Date; id: string };

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
