import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import worker from "../src/index.ts";

const token = `as_pub_${"A".repeat(43)}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const expiresAt = "2030-01-01T00:00:00.000Z";
const record = {
  tokenId: "pub_fixture_01",
  tokenHash,
  publisherId: "publisher-device-01",
  team: "w3dev",
  permissions: ["artifacts:publish"],
  expiresAt,
};

function makeEnv(overrides: Record<string, unknown> = {}) {
  const lookedUp: string[] = [];
  const env = {
    ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY: JSON.stringify({ version: 1, tokens: [record] }),
    R2_ACCOUNT_ID: "account-test",
    R2_BUCKET_NAME: "artifacts-test",
    ARTIFACTS_PUBLIC_PREFIX: "artifacts",
    R2_PARENT_ACCESS_KEY_ID: "parent-access-id",
    R2_PARENT_SECRET_ACCESS_KEY: "parent-secret-never-returned",
    ARTIFACTS_BUCKET: {
      async get(key: string) {
        lookedUp.push(key);
        return {
          body: new Response("artifact").body,
          httpEtag: '"fixture"',
          writeHttpMetadata(headers: Headers) { headers.set("Content-Type", "text/plain"); },
        };
      },
    },
    ...overrides,
  };
  return { env: env as never, lookedUp };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://artifacts.example.com${path}`, init);
}

describe("publisher auth routes", () => {
  it("returns the server-authorized identity and prevents caching", async () => {
    const { env } = makeEnv();
    const response = await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const identity = await response.json() as Record<string, unknown>;
    expect(identity.publisherId).toBe("publisher-device-01");
    expect(identity.team).toBe("w3dev");
    expect(identity.permissions).toEqual(["artifacts:publish"]);
    expect(identity.expiresAt).toBe(expiresAt);
    expect(identity.tokenId).toBe("pub_fixture_01");
  });

  it("returns no-store 401 for missing, malformed, expired, or revoked credentials", async () => {
    const { env } = makeEnv();
    const missing = await worker.fetch(request("/__api/v1/auth/me"), env);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");

    const malformed = await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: "Bearer not-a-publisher-token" },
    }), env);
    expect(malformed.status).toBe(401);

    const expiredEnv = makeEnv({
      ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY: JSON.stringify({
        version: 1,
        tokens: [{ ...record, expiresAt: "2020-01-01T00:00:00Z" }],
      }),
    }).env;
    expect((await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }), expiredEnv)).status).toBe(401);

    const revokedEnv = makeEnv({
      ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY: JSON.stringify({
        version: 1,
        tokens: [{ ...record, revokedAt: "2026-09-22T00:00:00Z" }],
      }),
    }).env;
    expect((await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }), revokedEnv)).status).toBe(401);
  });

  it("returns a no-store service error when the operator registry is unavailable or malformed", async () => {
    const { env } = makeEnv({ ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY: "not-json" });
    const response = await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const error = await response.json() as { error: string };
    expect(error.error).toBe("authentication_service_unavailable");

    const uploadResponse = await worker.fetch(request("/__api/v1/uploads/credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ team: "w3dev" }),
    }), env);
    expect(uploadResponse.status).toBe(503);
    expect(uploadResponse.headers.get("Cache-Control")).toBe("no-store");

    const leakedRecordEnv = makeEnv({
      ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY: JSON.stringify({
        version: 1,
        tokens: [{ ...record, token }],
      }),
    }).env;
    const leakedRecordResponse = await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    }), leakedRecordEnv);
    expect(leakedRecordResponse.status).toBe(503);
    expect(await leakedRecordResponse.text()).not.toContain(token);
  });

  it("requires publish permission and rejects a requested team mismatch", async () => {
    const deniedEnv = makeEnv({
      ARTIFACT_SYNC_PUBLISHER_TOKEN_REGISTRY: JSON.stringify({
        version: 1,
        tokens: [{ ...record, permissions: [] }],
      }),
    }).env;
    const noPermission = await worker.fetch(request("/__api/v1/uploads/credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ team: "w3dev" }),
    }), deniedEnv);
    expect(noPermission.status).toBe(403);

    const { env } = makeEnv();
    const mismatch = await worker.fetch(request("/__api/v1/uploads/credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ team: "other-team" }),
    }), env);
    expect(mismatch.status).toBe(403);
    expect(mismatch.headers.get("Cache-Control")).toBe("no-store");
  });

  it("mints 15-minute credentials scoped to the authorized prefix and PutObject only", async () => {
    const { env } = makeEnv();
    const response = await worker.fetch(request("/__api/v1/uploads/credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ team: "w3dev" }),
    }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as {
      accessKeyId: string; secretAccessKey: string; sessionToken: string;
      prefix: string; expiresAt: string;
    };
    expect(body.accessKeyId).toBe("parent-access-id");
    expect(body.secretAccessKey).not.toBe("parent-secret-never-returned");
    expect(body.prefix).toBe("teams/w3dev/artifacts/");
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(14 * 60 * 1000);

    const jwtText = atob(body.sessionToken).slice("jwt/".length);
    const [header, payload, signature] = jwtText.split(".");
    expect(JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))).toMatchObject({
      bucket: "artifacts-test",
      actions: ["PutObject"],
      paths: { prefixPaths: ["teams/w3dev/artifacts/"], objectPaths: [] },
    });
    expect(signature).toBeTruthy();
    expect(header).toBeTruthy();
  });

  it("serves public artifact content without using the publisher Authorization header", async () => {
    const { env, lookedUp } = makeEnv();
    const response = await worker.fetch(request("/artifacts/w3dev/reports/today.json", {
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("artifact");
    expect(lookedUp).toEqual(["teams/w3dev/artifacts/reports/today.json"]);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("rejects traversal in public artifact paths", async () => {
    const { env, lookedUp } = makeEnv();
    const response = await worker.fetch(request("/artifacts/w3dev/%2e%2e/private"), env);
    expect(response.status).toBe(404);
    expect(lookedUp).toEqual([]);
  });
});
