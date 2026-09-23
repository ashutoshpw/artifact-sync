import { and, eq, gt, isNull } from "drizzle-orm";
import { createDatabase } from "../db/client.ts";
import { apiTokens, teams, user } from "../db/schema.ts";
import { issueAccessToken } from "./jwt.ts";
import { ACCESS_TOKEN_SECONDS, PUBLISH_PERMISSION, READ_PERMISSION, REFRESH_IDLE_SECONDS, REFRESH_MAX_SECONDS } from "./types.ts";
import type { GatewayEnv, PublisherIdentity } from "./types.ts";

const API_SECRET_PREFIX = "as_api_";
const REFRESH_SECRET_PREFIX = "as_rf_";
const DEVICE_SECRET_PREFIX = "as_dev_";
const SECRET_PATTERN = /^as_(?:api|rf|dev)_[A-Za-z0-9_-]{43}$/;

export interface TokenOwner {
  id: string;
  email: string;
  name: string;
}

export interface TokenTeam {
  id: string;
  slug: string;
}

export interface TokenRecord {
  id: string;
  userId: string;
  teamId: string;
  name: string;
  refreshTokenHash: string;
  permissions: string;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function isRefreshCredential(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

export async function createRefreshCredential(prefix = API_SECRET_PREFIX): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}${encodeBase64Url(bytes)}`;
}

export async function hashCredential(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newApiTokenId(): string {
  return `api_${crypto.randomUUID()}`;
}

export async function insertApiToken(
  env: GatewayEnv,
  input: {
    id: string;
    userId: string;
    teamId: string;
    name: string;
    refreshCredential: string;
    now?: Date;
  },
): Promise<void> {
  const db = createDatabase(env.DB);
  const now = input.now ?? new Date();
  const absoluteExpiry = new Date(now.getTime() + REFRESH_MAX_SECONDS * 1000);
  const idleExpiry = new Date(Math.min(
    now.getTime() + REFRESH_IDLE_SECONDS * 1000,
    absoluteExpiry.getTime(),
  ));
  await db.insert(apiTokens).values({
    id: input.id,
    userId: input.userId,
    teamId: input.teamId,
    name: input.name,
    refreshTokenHash: await hashCredential(input.refreshCredential),
    permissions: JSON.stringify([PUBLISH_PERMISSION, READ_PERMISSION]),
    createdAt: now,
    lastUsedAt: now,
    idleExpiresAt: idleExpiry,
    expiresAt: absoluteExpiry,
    revokedAt: null,
  }).onConflictDoNothing();
}

export async function issueTokenResponse(
  env: GatewayEnv,
  record: TokenRecord,
  owner: TokenOwner,
  team: TokenTeam,
  refreshCredential: string,
  now = Math.floor(Date.now() / 1000),
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; identity: PublisherIdentity }> {
  const permissions = parsePermissions(record.permissions);
  const access = await issueAccessToken(env, {
    sub: owner.id,
    email: owner.email,
    name: owner.name,
    teamId: team.id,
    team: team.slug,
    permissions,
    tokenId: record.id,
  }, now);

  return {
    accessToken: access.token,
    refreshToken: refreshCredential,
    expiresAt: access.expiresAt,
    identity: {
      userId: owner.id,
      email: owner.email,
      name: owner.name,
      teamId: team.id,
      team: team.slug,
      permissions,
      expiresAt: access.expiresAt,
      tokenId: record.id,
    },
  };
}

export async function refreshCredential(
  env: GatewayEnv,
  credential: string,
  rotate = true,
  now = new Date(),
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; identity: PublisherIdentity } | null> {
  if (!isRefreshCredential(credential)) return null;
  if (!rotate && !credential.startsWith(API_SECRET_PREFIX)) return null;
  const db = createDatabase(env.DB);
  const oldHash = await hashCredential(credential);
  const result = await db.select({
    token: apiTokens,
    owner: user,
    team: teams,
  })
    .from(apiTokens)
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .innerJoin(teams, eq(apiTokens.teamId, teams.id))
    .where(and(
      eq(apiTokens.refreshTokenHash, oldHash),
      isNull(apiTokens.revokedAt),
      gt(apiTokens.expiresAt, now),
      gt(apiTokens.idleExpiresAt, now),
    ))
    .limit(1);
  const current = result[0];
  if (!current) return null;

  const nextCredential = rotate
    ? await createRefreshCredential(REFRESH_SECRET_PREFIX)
    : credential;
  const idleExpiry = new Date(Math.min(
    now.getTime() + REFRESH_IDLE_SECONDS * 1000,
    current.token.expiresAt.getTime(),
  ));
  const changed = await db.update(apiTokens)
    .set({
      refreshTokenHash: rotate ? await hashCredential(nextCredential) : oldHash,
      lastUsedAt: now,
      idleExpiresAt: idleExpiry,
    })
    .where(and(
      eq(apiTokens.id, current.token.id),
      eq(apiTokens.refreshTokenHash, oldHash),
      isNull(apiTokens.revokedAt),
      gt(apiTokens.expiresAt, now),
      gt(apiTokens.idleExpiresAt, now),
    ))
    .returning({ id: apiTokens.id });
  if (changed.length !== 1) return null;

  return issueTokenResponse(
    env,
    current.token,
    current.owner,
    current.team,
    nextCredential,
    Math.floor(now.getTime() / 1000),
  );
}

export function deviceCredentialPrefix(): string {
  return DEVICE_SECRET_PREFIX;
}

function parsePermissions(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("stored token permissions are invalid");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => item !== PUBLISH_PERMISSION && item !== READ_PERMISSION)) {
    throw new Error("stored token permissions are invalid");
  }
  return [...new Set(parsed)];
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
