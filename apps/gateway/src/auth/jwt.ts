import { ACCESS_TOKEN_SECONDS, PUBLISH_PERMISSION, READ_PERMISSION } from "./types.ts";
import type { GatewayEnv, PublisherIdentity } from "./types.ts";

const ISSUER = "artifact-sync";
const AUDIENCE = "artifact-sync-gateway";
const TOKEN_HEADER = { alg: "HS256", typ: "JWT" } as const;
const URL_SAFE = /^[A-Za-z0-9_-]+$/;

interface AccessClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  name: string;
  teamId: string;
  team: string;
  permissions: string[];
  tokenId: string;
  iat: number;
  exp: number;
}

export class JwtConfigurationError extends Error {
  constructor() {
    super("access-token signing is not configured");
    this.name = "JwtConfigurationError";
  }
}

export async function issueAccessToken(
  env: GatewayEnv,
  input: Omit<AccessClaims, "iss" | "aud" | "iat" | "exp">,
  now = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: string }> {
  const key = await signingKey(env);
  const claims: AccessClaims = {
    ...input,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ACCESS_TOKEN_SECONDS,
  };
  const unsigned = `${encodeJson(TOKEN_HEADER)}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned));
  return {
    token: `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export async function verifyAccessToken(
  env: GatewayEnv,
  token: string,
  now = Math.floor(Date.now() / 1000),
): Promise<PublisherIdentity | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !URL_SAFE.test(part)) || token.length > 8192) return null;

  let header: unknown;
  let claims: unknown;
  let signature: Uint8Array;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
    signature = decodeBase64Url(parts[2]);
  } catch {
    return null;
  }
  if (!isRecord(header) || header.alg !== "HS256" || header.typ !== "JWT" || !validClaims(claims, now)) {
    return null;
  }

  const key = await signingKey(env);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(signature),
    toArrayBuffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`)),
  );
  if (!valid) return null;

  return {
    userId: claims.sub,
    email: claims.email,
    name: claims.name,
    teamId: claims.teamId,
    team: claims.team,
    permissions: claims.permissions,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    tokenId: claims.tokenId,
  };
}

async function signingKey(env: GatewayEnv): Promise<CryptoKey> {
  if (typeof env.JWT_SECRET !== "string" || new TextEncoder().encode(env.JWT_SECRET).byteLength < 32) {
    throw new JwtConfigurationError();
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(env.JWT_SECRET)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function validClaims(value: unknown, now: number): value is AccessClaims {
  if (!isRecord(value)) return false;
  const permissions = value.permissions;
  const issuedAt = value.iat;
  const expiresAt = value.exp;
  return value.iss === ISSUER
    && value.aud === AUDIENCE
    && typeof value.sub === "string" && value.sub.length > 0
    && typeof value.email === "string" && value.email.length > 0
    && typeof value.name === "string" && value.name.length > 0
    && typeof value.teamId === "string" && value.teamId.length > 0
    && typeof value.team === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value.team)
    && Array.isArray(permissions)
    && permissions.length > 0
    && permissions.every((permission) => permission === PUBLISH_PERMISSION || permission === READ_PERMISSION)
    && typeof value.tokenId === "string" && value.tokenId.length > 0
    && typeof issuedAt === "number" && Number.isSafeInteger(issuedAt) && issuedAt <= now + 60
    && typeof expiresAt === "number" && Number.isSafeInteger(expiresAt) && expiresAt > now
    && expiresAt - issuedAt <= ACCESS_TOKEN_SECONDS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as unknown;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!URL_SAFE.test(value)) throw new Error("invalid base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
