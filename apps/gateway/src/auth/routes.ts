import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { createDatabase } from "../db/client.ts";
import { apiTokens, deviceAuthorizations, teamMemberships, teams, user } from "../db/schema.ts";
import { authenticate, authError, noStoreHeaders } from "./middleware.ts";
import { issueTokenResponse, createRefreshCredential, deviceCredentialPrefix, hashCredential, insertApiToken, newApiTokenId, refreshCredential } from "./token-service.ts";
import { requireBrowserIdentity } from "./identity.ts";
import { safePermissions } from "./permissions.ts";
import { canManageApiToken } from "./team-routes.ts";
import { PUBLISH_PERMISSION, READ_PERMISSION, REFRESH_MAX_SECONDS } from "./types.ts";
import type { GatewayEnv } from "./types.ts";

const DEVICE_CODE_PATTERN = /^as_dev_[A-Za-z0-9_-]{43}$/;
const USER_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const HUMAN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEVICE_CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

export async function handleAuthMe(request: Request, env: GatewayEnv): Promise<Response> {
  const context = await authenticate(request, env);
  if (context instanceof Response) return context;
  return Response.json(context.identity, { headers: noStoreHeaders() });
}

export async function handleRefresh(request: Request, env: GatewayEnv): Promise<Response> {
  const body = await readJson(request);
  if (!isObject(body) || typeof body.refreshToken !== "string") return authError(400, "invalid_request");
  if (body.rotate !== undefined && typeof body.rotate !== "boolean") return authError(400, "invalid_request");
  try {
    const result = await refreshCredential(env, body.refreshToken, body.rotate !== false);
    if (!result) return authError(401, "invalid_or_expired_credentials");
    return Response.json(result, { headers: noStoreHeaders() });
  } catch {
    return authError(503, "authentication_service_unavailable");
  }
}

export async function handleTeams(request: Request, env: GatewayEnv): Promise<Response> {
  const identity = await requireBrowserIdentity(request, env);
  if (identity instanceof Response) return identity;
  try {
    const db = createDatabase(env.DB);
    const memberships = await db.select({ id: teams.id, name: teams.name, slug: teams.slug, role: teamMemberships.role })
      .from(teamMemberships)
      .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
      .where(eq(teamMemberships.userId, identity.id))
      .orderBy(teams.name);
    return Response.json({ teams: memberships }, { headers: noStoreHeaders() });
  } catch {
    return authError(503, "identity_service_unavailable");
  }
}

export async function handleApiTokens(request: Request, env: GatewayEnv): Promise<Response> {
  const identity = await requireBrowserIdentity(request, env);
  if (identity instanceof Response) return identity;
  const db = createDatabase(env.DB);

  if (request.method === "GET") {
    try {
      const rows = await db.select({
        id: apiTokens.id,
        name: apiTokens.name,
        teamId: teams.id,
        team: teams.slug,
        permissions: apiTokens.permissions,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
        idleExpiresAt: apiTokens.idleExpiresAt,
        expiresAt: apiTokens.expiresAt,
        revokedAt: apiTokens.revokedAt,
      })
        .from(apiTokens)
        .innerJoin(teams, eq(apiTokens.teamId, teams.id))
        .where(eq(apiTokens.userId, identity.id))
        .orderBy(desc(apiTokens.createdAt));
      return Response.json({ tokens: rows.map((row) => ({
        ...row,
        permissions: safePermissions(row.permissions),
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        idleExpiresAt: row.idleExpiresAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
      })) }, { headers: noStoreHeaders() });
    } catch {
      return authError(503, "token_service_unavailable");
    }
  }

  if (request.method !== "POST") return authError(400, "invalid_request");
  const body = await readJson(request);
  if (!isObject(body) || typeof body.name !== "string" || typeof body.teamId !== "string") {
    return authError(400, "invalid_request");
  }
  const name = body.name.trim();
  if (!name || name.length > 64) return authError(400, "invalid_token_name");

  try {
    const [membership] = await db.select({ teamId: teams.id, team: teams.slug })
      .from(teamMemberships)
      .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
      .where(and(eq(teamMemberships.userId, identity.id), eq(teams.id, body.teamId)))
      .limit(1);
    if (!membership) return authError(403, "team_access_required");

    const refreshToken = await createRefreshCredential();
    const id = newApiTokenId();
    await insertApiToken(env, {
      id,
      userId: identity.id,
      teamId: membership.teamId,
      name,
      refreshCredential: refreshToken,
    });
    return Response.json({
      id,
      name,
      teamId: membership.teamId,
      team: membership.team,
      token: refreshToken,
      permissions: [PUBLISH_PERMISSION, READ_PERMISSION],
      refreshIdleDays: 30,
      expiresAt: new Date(Date.now() + REFRESH_MAX_SECONDS * 1000).toISOString(),
    }, { status: 201, headers: noStoreHeaders() });
  } catch {
    return authError(503, "token_service_unavailable");
  }
}

export async function handleRevokeApiToken(request: Request, env: GatewayEnv, tokenId: string): Promise<Response> {
  const identity = await requireBrowserIdentity(request, env);
  if (identity instanceof Response) return identity;
  if (!/^api_[0-9a-f-]{36}$/i.test(tokenId)) return authError(404, "token_not_found");
  try {
    const db = createDatabase(env.DB);
    const [token] = await db.select({ userId: apiTokens.userId, teamId: apiTokens.teamId })
      .from(apiTokens)
      .where(eq(apiTokens.id, tokenId))
      .limit(1);
    if (!token || !await canManageApiToken(db, identity, token)) return authError(404, "token_not_found");
    const changed = await db.update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });
    if (!changed.length) return authError(404, "token_not_found");
    return new Response(null, { status: 204, headers: noStoreHeaders() });
  } catch {
    return authError(503, "token_service_unavailable");
  }
}

export async function handleDeviceStart(request: Request, env: GatewayEnv): Promise<Response> {
  if (request.method !== "POST") return authError(400, "invalid_request");
  const body = await readJson(request);
  if (body !== null && !isObject(body)) return authError(400, "invalid_request");
  const deviceName = optionalMetadataString(body?.deviceName, 80);
  const platform = optionalMetadataString(body?.platform, 32);
  const clientVersion = optionalMetadataString(body?.clientVersion, 32);
  if (deviceName === undefined || platform === undefined || clientVersion === undefined) {
    return authError(400, "invalid_device_metadata");
  }
  try {
    const db = createDatabase(env.DB);
    const deviceCode = await createRefreshCredential(deviceCredentialPrefix());
    const userCode = await createUserCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await db.insert(deviceAuthorizations).values({
      id: `device_${crypto.randomUUID()}`,
      deviceCodeHash: await hashCredential(deviceCode),
      userCode,
      status: "pending",
      expiresAt,
      createdAt: now,
      userId: null,
      teamId: null,
      apiTokenId: null,
      deviceName,
      platform,
      clientVersion,
    });
    const verificationUrl = new URL("/auth/device", env.APP_ORIGIN);
    verificationUrl.searchParams.set("code", userCode);
    return Response.json({
      deviceCode,
      userCode,
      verificationUrl: verificationUrl.toString(),
      intervalSeconds: 3,
      expiresAt: expiresAt.toISOString(),
    }, { status: 201, headers: noStoreHeaders() });
  } catch {
    return authError(503, "device_authorization_unavailable");
  }
}

export async function handleDeviceApprove(request: Request, env: GatewayEnv): Promise<Response> {
  const identity = await requireBrowserIdentity(request, env);
  if (identity instanceof Response) return identity;
  const body = await readJson(request);
  if (!isObject(body) || typeof body.userCode !== "string" || typeof body.teamId !== "string") {
    return authError(400, "invalid_request");
  }
  const userCode = body.userCode.toUpperCase();
  if (!USER_CODE_PATTERN.test(userCode)) return authError(400, "invalid_device_code");

  try {
    const db = createDatabase(env.DB);
    const [membership] = await db.select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, body.teamId), eq(teamMemberships.userId, identity.id)))
      .limit(1);
    if (!membership) return authError(403, "team_access_required");

    const changed = await db.update(deviceAuthorizations)
      .set({ status: "approved", userId: identity.id, teamId: membership.teamId })
      .where(and(
        eq(deviceAuthorizations.userCode, userCode),
        eq(deviceAuthorizations.status, "pending"),
        gt(deviceAuthorizations.expiresAt, new Date()),
      ))
      .returning({ id: deviceAuthorizations.id });
    if (!changed.length) return authError(404, "device_request_not_found_or_expired");
    return Response.json({ approved: true }, { headers: noStoreHeaders() });
  } catch {
    return authError(503, "device_authorization_unavailable");
  }
}

export async function handleDevicePoll(request: Request, env: GatewayEnv): Promise<Response> {
  const body = await readJson(request);
  if (!isObject(body) || typeof body.deviceCode !== "string" || !DEVICE_CODE_PATTERN.test(body.deviceCode)) {
    return authError(400, "invalid_request");
  }
  const codeHash = await hashCredential(body.deviceCode);
  try {
    const db = createDatabase(env.DB);
    const [device] = await db.select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.deviceCodeHash, codeHash))
      .limit(1);
    if (!device || device.expiresAt.getTime() <= Date.now()) return authError(410, "device_code_expired");
    if (device.status === "pending") {
      return Response.json({ error: "authorization_pending" }, { status: 202, headers: noStoreHeaders() });
    }
    if (device.status === "denied") return authError(403, "device_request_denied");
    if (!device.userId || !device.teamId) return authError(401, "invalid_device_code");
    if (device.deliveredAt) return authError(401, "device_code_already_used_or_revoked");

    const now = new Date();
    const claimId = crypto.randomUUID();
    const claimCutoff = new Date(now.getTime() - DEVICE_CLAIM_TIMEOUT_MS);
    const [claimed] = await db.update(deviceAuthorizations)
      .set({ claimId, claimedAt: now })
      .where(and(
        eq(deviceAuthorizations.id, device.id),
        isNull(deviceAuthorizations.deliveredAt),
        or(
          isNull(deviceAuthorizations.claimId),
          isNull(deviceAuthorizations.claimedAt),
          lte(deviceAuthorizations.claimedAt, claimCutoff),
        ),
      ))
      .returning({ id: deviceAuthorizations.id });
    if (!claimed) return Response.json({ error: "authorization_pending" }, { status: 202, headers: noStoreHeaders() });

    const tokenId = device.apiTokenId ?? `api_${device.id.slice("device_".length)}`;
    if (device.status === "approved" || !device.apiTokenId) {
      await insertApiToken(env, {
        id: tokenId,
        userId: device.userId,
        teamId: device.teamId,
        name: device.deviceName || "artifact-sync device",
        refreshCredential: body.deviceCode,
      });
      await db.update(deviceAuthorizations)
        .set({ status: "completed", apiTokenId: tokenId })
        .where(and(eq(deviceAuthorizations.id, device.id), eq(deviceAuthorizations.claimId, claimId)));
    }

    const [active] = await db.select({ token: apiTokens, owner: user, team: teams })
      .from(apiTokens)
      .innerJoin(user, eq(apiTokens.userId, user.id))
      .innerJoin(teams, eq(apiTokens.teamId, teams.id))
      .where(and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.refreshTokenHash, codeHash),
        eq(apiTokens.userId, device.userId),
        eq(apiTokens.teamId, device.teamId),
        gt(apiTokens.expiresAt, now),
        gt(apiTokens.idleExpiresAt, now),
      ))
      .limit(1);
    if (!active || active.token.revokedAt) return authError(401, "device_code_already_used_or_revoked");

    const delivered = await env.DB.prepare(`
      UPDATE device_authorizations
      SET delivered_at = ?
      WHERE id = ? AND claim_id = ? AND delivered_at IS NULL AND status = 'completed'
        AND EXISTS (
          SELECT 1 FROM api_tokens
          WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL
            AND expires_at > ? AND idle_expires_at > ?
        )
      RETURNING id
    `).bind(
      now.getTime(),
      device.id,
      claimId,
      tokenId,
      codeHash,
      now.getTime(),
      now.getTime(),
    ).first<{ id: string }>();
    if (!delivered) return authError(401, "device_code_already_used_or_revoked");

    return Response.json(await issueTokenResponse(env, active.token, active.owner, active.team, body.deviceCode), {
      headers: noStoreHeaders(),
    });
  } catch {
    return authError(503, "device_authorization_unavailable");
  }
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

function optionalMetadataString(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) return undefined;
  return normalized;
}

async function createUserCode(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => HUMAN_CODE_ALPHABET[byte % HUMAN_CODE_ALPHABET.length]).join("");
}
