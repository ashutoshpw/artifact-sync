import { describe, expect, it } from "bun:test";
import worker from "../src/index.ts";
import { issueAccessToken } from "../src/auth/jwt.ts";
import { ACCESS_TOKEN_SECONDS, PUBLISH_PERMISSION, READ_PERMISSION } from "../src/auth/types.ts";

const JWT_SECRET = "test-secret-for-hmac-that-is-at-least-32-bytes";

async function accessToken(overrides: Record<string, unknown> = {}, now = Math.floor(Date.now() / 1000)) {
  return issueAccessToken({ JWT_SECRET } as never, {
    sub: "user-123",
    email: "publisher@example.test",
    name: "Publisher",
    teamId: "team-abc123",
    team: "w3dev",
    permissions: [PUBLISH_PERMISSION, READ_PERMISSION],
    tokenId: "api_12345678-1234-4234-9234-123456789abc",
    ...overrides,
  }, now);
}

function makeEnv() {
  const uploads: Array<{ key: string; body: string; contentType?: string }> = [];
  const lookups: string[] = [];
  const env = {
    JWT_SECRET,
    APP_ORIGIN: "https://artifact.w3dev.app",
    DB: {},
    EMAIL: {},
    ARTIFACTS_BUCKET: {
      async put(key: string, body: ReadableStream<Uint8Array>, options?: R2PutOptions) {
        const metadata = options?.httpMetadata;
        const contentType = metadata && !(metadata instanceof Headers) ? metadata.contentType : undefined;
        uploads.push({ key, body: await new Response(body).text(), contentType });
        return {};
      },
      async get(key: string) {
        lookups.push(key);
        return {
          body: new Response("private artifact").body,
          size: 16,
          uploaded: new Date("2026-09-23T00:00:00.000Z"),
          httpEtag: '"fixture"',
          writeHttpMetadata(headers: Headers) { headers.set("Content-Type", "application/json"); },
        };
      },
      async list(options: R2ListOptions) {
        return {
          objects: [{
            key: `${options.prefix}reports/today.json`,
            size: 16,
            uploaded: new Date("2026-09-23T00:00:00.000Z"),
            httpEtag: '"fixture"',
          }],
          delimitedPrefixes: [],
          truncated: false,
        };
      },
    },
  };
  return { env: env as never, uploads, lookups };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://artifact.w3dev.app${path}`, init);
}

describe("team-scoped JWT authentication and private artifact routes", () => {
  it("returns the locally verified user/team identity without caching", async () => {
    const { env } = makeEnv();
    const token = await accessToken();
    const response = await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token.token}` },
    }), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    const identity = await response.json() as Record<string, unknown>;
    expect(identity).toEqual({
      userId: "user-123",
      email: "publisher@example.test",
      name: "Publisher",
      teamId: "team-abc123",
      team: "w3dev",
      permissions: [PUBLISH_PERMISSION, READ_PERMISSION],
      expiresAt: token.expiresAt,
      tokenId: "api_12345678-1234-4234-9234-123456789abc",
    });
  });

  it("rejects missing, modified, and expired JWTs with no-store 401 responses", async () => {
    const { env } = makeEnv();
    const missing = await worker.fetch(request("/__api/v1/auth/me"), env);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");

    const issued = await accessToken();
    const [header, payload, signature] = issued.token.split(".");
    const alteredSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const modified = await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: `Bearer ${header}.${payload}.${alteredSignature}` },
    }), env);
    expect(modified.status).toBe(401);

    const expired = await accessToken({}, Math.floor(Date.now() / 1000) - ACCESS_TOKEN_SECONDS - 1);
    const expiredResponse = await worker.fetch(request("/__api/v1/auth/me", {
      headers: { Authorization: `Bearer ${expired.token}` },
    }), env);
    expect(expiredResponse.status).toBe(401);
    expect(expiredResponse.headers.get("Cache-Control")).toBe("no-store");
  });

  it("derives the R2 key from the JWT team ID and never passes Authorization to R2", async () => {
    const { env, uploads } = makeEnv();
    const token = await accessToken();
    const response = await worker.fetch(request("/__api/v1/uploads?path=reports%2Ftoday.json", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "text/html",
        "X-Team": "attacker-team",
      },
      body: "{\"ok\":true}",
    }), env);

    expect(response.status).toBe(201);
    expect(uploads).toEqual([{
      key: "uploads/team-abc123/artifacts/reports/today.json",
      body: "{\"ok\":true}",
      contentType: "application/json; charset=utf-8",
    }]);
    expect(await response.text()).not.toContain(token.token);
  });

  it("returns 403 for an authenticated read-only identity attempting to publish", async () => {
    const { env, uploads } = makeEnv();
    const token = await accessToken({ permissions: [READ_PERMISSION] });
    const response = await worker.fetch(request("/__api/v1/uploads?path=reports%2Ftoday.json", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token.token}` },
      body: "{}",
    }), env);

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(uploads).toEqual([]);
  });

  it("requires team-scoped read authorization and serves content with no-store protections", async () => {
    const { env, lookups } = makeEnv();
    const token = await accessToken();
    const denied = await worker.fetch(request("/another-team/private.json", {
      headers: { Authorization: `Bearer ${token.token}` },
    }), env);
    expect(denied.status).toBe(403);
    expect(lookups).toEqual([]);

    const response = await worker.fetch(request("/w3dev/reports/today.json", {
      headers: { Authorization: `Bearer ${token.token}` },
    }), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private artifact");
    expect(lookups).toEqual(["uploads/team-abc123/artifacts/reports/today.json"]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("rejects traversal and provides team-bounded listing", async () => {
    const { env, lookups } = makeEnv();
    const token = await accessToken();
    const traversal = await worker.fetch(request("/w3dev/%2e%2e/private", {
      headers: { Authorization: `Bearer ${token.token}` },
    }), env);
    expect(traversal.status).toBe(404);
    expect(lookups).toEqual([]);

    const listing = await worker.fetch(request("/__api/v1/artifacts", {
      headers: { Authorization: `Bearer ${token.token}` },
    }), env);
    expect(listing.status).toBe(200);
    expect(await listing.json()).toMatchObject({
      team: "w3dev",
      objects: [{ path: "reports/today.json" }],
      truncated: false,
      cursor: null,
    });
  });

  it("serves login, API-token, and device routes without embedding credentials", async () => {
    const { env } = makeEnv();
    const login = await worker.fetch(request("/auth/login"), env);
    expect(login.status).toBe(200);
    const loginHtml = await login.text();
    expect(loginHtml).toContain("sign-up/email");
    expect(loginHtml).toContain("sign-in/social");
    expect(loginHtml).not.toContain(JWT_SECRET);
    expect(login.headers.get("Cache-Control")).toBe("no-store");

    const tokens = await worker.fetch(request("/settings/api-tokens"), env);
    expect(tokens.status).toBe(302);
    expect(tokens.headers.get("Location")).toContain("returnTo=%2Fsettings%2Fapi-tokens");

    const device = await worker.fetch(request("/auth/device"), env);
    expect(device.status).toBe(302);
    expect(device.headers.get("Location")).toContain("returnTo=%2Fauth%2Fdevice");
  });

  it("escapes untrusted return paths before embedding them in an inline script", async () => {
    const { env } = makeEnv();
    const login = await worker.fetch(request("/auth/login?returnTo=%2F%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E"), env);
    const html = await login.text();

    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003ealert(1)");
  });
});
