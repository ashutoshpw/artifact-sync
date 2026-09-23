import type { GatewayEnv, PublisherIdentity } from "./types.ts";

const TTL_SECONDS = 900;

function toBase64Url(value: string): string {
  return btoa(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function toBase64(value: string): string {
  return btoa(value);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface TemporaryUploadCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  endpoint: string;
  bucket: string;
  prefix: string;
  expiresAt: string;
}

export async function createTemporaryUploadCredentials(
  identity: PublisherIdentity,
  env: GatewayEnv,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TemporaryUploadCredentials> {
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const endpointHost = new URL(endpoint).host;
  const prefix = `teams/${identity.team}/artifacts/`;
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({
    bucket: env.R2_BUCKET_NAME,
    scope: "object-read-write",
    actions: ["PutObject"],
    paths: { prefixPaths: [prefix], objectPaths: [] },
    sub: env.R2_ACCOUNT_ID,
    iss: env.R2_PARENT_ACCESS_KEY_ID,
    aud: endpointHost,
    iat: nowSeconds,
    exp: nowSeconds + TTL_SECONDS,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.R2_PARENT_SECRET_ACCESS_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${toBase64Url(String.fromCharCode(...signature))}`;
  const secretDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jwt)));

  return {
    accessKeyId: env.R2_PARENT_ACCESS_KEY_ID,
    secretAccessKey: toHex(secretDigest),
    sessionToken: toBase64(`jwt/${jwt}`),
    endpoint,
    bucket: env.R2_BUCKET_NAME,
    prefix,
    expiresAt: new Date((nowSeconds + TTL_SECONDS) * 1000).toISOString(),
  };
}
