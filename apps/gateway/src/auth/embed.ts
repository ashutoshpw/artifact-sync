import { signingKey } from "./jwt.ts";
import type { GatewayEnv } from "./types.ts";

const EMBED_ISSUER = "artifact-sync";
const EMBED_AUDIENCE = "artifact-sync-embed";
const EMBED_SCOPE = "artifact-embed";
const EMBED_TOKEN_HEADER = { alg: "HS256", typ: "JWT" } as const;
const URL_SAFE = /^[A-Za-z0-9_-]+$/;

export const EMBED_COOKIE = "artifact_embed";
export const EMBED_TTL_SECONDS = 24 * 60 * 60;

interface EmbedClaims {
  iss: string;
  aud: string;
  scope: string;
  teamId: string;
  iat: number;
  exp: number;
}

export interface EmbedToken {
  token: string;
  expiresAt: string;
}

export function issueEmbedToken(
  env: GatewayEnv,
  teamId: string,
  now = Math.floor(Date.now() / 1000),
): Promise<EmbedToken> {
  return signEmbedClaims(env, {
    iss: EMBED_ISSUER,
    aud: EMBED_AUDIENCE,
    scope: EMBED_SCOPE,
    teamId,
    iat: now,
    exp: now + EMBED_TTL_SECONDS,
  });
}

export async function verifyEmbedToken(
  env: GatewayEnv,
  token: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !URL_SAFE.test(part))) return null;

  let claims: unknown;
  let signature: Uint8Array;
  try {
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as unknown;
    signature = decodeBase64Url(parts[2]);
  } catch {
    return null;
  }
  if (!validEmbedClaims(claims, now)) return null;

  try {
    const key = await signingKey(env);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      toArrayBuffer(signature),
      toArrayBuffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`)),
    );
    return valid ? claims.teamId : null;
  } catch {
    return null;
  }
}

async function signEmbedClaims(env: GatewayEnv, claims: EmbedClaims): Promise<EmbedToken> {
  const key = await signingKey(env);
  const unsigned = `${encodeJson(EMBED_TOKEN_HEADER)}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned));
  return {
    token: `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

function validEmbedClaims(value: unknown, now: number): value is EmbedClaims {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return claims.iss === EMBED_ISSUER
    && claims.aud === EMBED_AUDIENCE
    && claims.scope === EMBED_SCOPE
    && typeof claims.teamId === "string" && claims.teamId.length > 0
    && typeof claims.iat === "number" && Number.isSafeInteger(claims.iat) && claims.iat <= now + 60
    && typeof claims.exp === "number" && Number.isSafeInteger(claims.exp) && claims.exp > now
    && claims.exp - claims.iat <= EMBED_TTL_SECONDS;
}

export function embedCookieHeader(token: string): string {
  return `${EMBED_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=${EMBED_TTL_SECONDS}`;
}

export type EmbedCredentialSource = "cookie" | "query";

export async function findEmbedCredential(
  request: Request,
  env: GatewayEnv,
  expectedTeamId: string,
): Promise<EmbedCredentialSource | null> {
  // Keep an explicit share URL authoritative when the browser also sends a
  // session or partitioned cookie; HTML/CSS responses propagate this token.
  const candidates: Array<{ source: EmbedCredentialSource; value: string | null }> = [
    { source: "query", value: new URL(request.url).searchParams.get("token") },
    { source: "cookie", value: readCookie(request, EMBED_COOKIE) },
  ];
  for (const { source, value } of candidates) {
    if (!value) continue;
    const teamId = await verifyEmbedToken(env, value).catch(() => null);
    if (teamId !== null && teamId === expectedTeamId) return source;
  }
  return null;
}

function readCookie(request: Request, name: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(request.headers.get("Cookie") ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
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
