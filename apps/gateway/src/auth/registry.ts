import type { GatewayEnv, PublisherIdentity, PublisherRegistry, PublisherTokenRecord } from "./types.ts";

const TOKEN_PATTERN = /^as_pub_[A-Za-z0-9_-]{43}$/;
const TOKEN_ID_PATTERN = /^pub_[A-Za-z0-9_-]{1,64}$/;
const TEAM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SUPPORTED_PERMISSIONS = new Set(["artifacts:publish"]);

export class RegistryConfigurationError extends Error {
  constructor() {
    super("publisher token registry is unavailable or invalid");
    this.name = "RegistryConfigurationError";
  }
}

function decodeHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenRecord(value: unknown): value is PublisherTokenRecord {
  if (!isRecord(value)) return false;
  const record = value;
  const allowedKeys = new Set(["tokenId", "tokenHash", "publisherId", "team", "permissions", "expiresAt", "revokedAt"]);
  if (!Object.keys(record).every((key) => allowedKeys.has(key))) return false;
  return typeof record.tokenId === "string" && TOKEN_ID_PATTERN.test(record.tokenId)
    && typeof record.tokenHash === "string" && /^[a-f0-9]{64}$/.test(record.tokenHash)
    && typeof record.publisherId === "string" && record.publisherId.trim().length > 0
    && typeof record.team === "string" && TEAM_PATTERN.test(record.team)
    && Array.isArray(record.permissions)
    && record.permissions.every((permission) => typeof permission === "string" && SUPPORTED_PERMISSIONS.has(permission))
    && new Set(record.permissions).size === record.permissions.length
    && validDateTime(record.expiresAt)
    && (record.revokedAt === undefined || validDateTime(record.revokedAt));
}

function isRegistry(value: unknown): value is PublisherRegistry {
  if (!isRecord(value)) return false;
  const registry = value;
  if (!Object.keys(registry).every((key) => key === "version" || key === "tokens")) return false;
  if (registry.version !== 1 || !Array.isArray(registry.tokens) || !registry.tokens.every(isTokenRecord)) return false;
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const entry of registry.tokens) {
    if (ids.has(entry.tokenId) || hashes.has(entry.tokenHash)) return false;
    ids.add(entry.tokenId);
    hashes.add(entry.tokenHash);
  }
  return true;
}

export function loadRegistry(env: GatewayEnv): PublisherRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY);
  } catch {
    throw new RegistryConfigurationError();
  }
  if (!isRegistry(parsed)) throw new RegistryConfigurationError();
  return parsed;
}

export async function resolvePublisher(token: string, env: GatewayEnv, now = Date.now()): Promise<PublisherIdentity | null> {
  if (!TOKEN_PATTERN.test(token)) return null;

  const registry = loadRegistry(env);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  let matched: PublisherTokenRecord | undefined;
  for (const candidate of registry.tokens) {
    const expected = decodeHex(candidate.tokenHash);
    if (constantTimeEqual(digest, expected)) matched = candidate;
  }

  if (!matched || matched.revokedAt) return null;
  const expiresAtMs = Date.parse(matched.expiresAt);
  if (!Number.isFinite(expiresAtMs) || now >= expiresAtMs) return null;

  return {
    publisherId: matched.publisherId,
    team: matched.team,
    permissions: matched.permissions,
    expiresAt: matched.expiresAt,
    tokenId: matched.tokenId,
  };
}
