import { describe, expect, it } from "bun:test";
import worker from "../src/index.tsx";
import { withNoStore } from "../src/auth/middleware.ts";
import { issueAccessToken } from "../src/auth/jwt.ts";
import { issueEmbedToken, verifyEmbedToken } from "../src/auth/embed.ts";
import { issueDashboardCsrfToken } from "../src/auth/csrf.ts";
import { serveArtifact, uploadArtifact } from "../src/content/routes.ts";
import { createArtifactShareToken } from "../src/content/share.ts";
import { createWebAuth } from "../src/auth/better-auth.ts";
import { ACCESS_TOKEN_SECONDS, PUBLISH_PERMISSION, READ_PERMISSION } from "../src/auth/types.ts";
import { createMigratedDb } from "./d1.ts";

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

function makeEnv(db: D1Database | null = null) {
  const uploads: Array<{ key: string; body: string; contentType?: string }> = [];
  const lookups: string[] = [];
  const objects = new Map<string, { body: string; contentType: string; size?: number }>();
  const env = {
    JWT_SECRET,
    BETTER_AUTH_SECRET: "test-better-auth-secret-that-is-long-enough",
    APP_ORIGIN: "https://artifact.w3dev.app",
    DASHBOARD_LAYOUT: "sidebar",
    DB: db ?? {},
    EMAIL: {},
    ARTIFACTS_BUCKET: {
      async put(key: string, body: ReadableStream<Uint8Array>, options?: R2PutOptions) {
        const metadata = options?.httpMetadata;
        const contentType = metadata && !(metadata instanceof Headers) ? metadata.contentType : undefined;
        const text = await new Response(body).text();
        uploads.push({ key, body: text, contentType });
        objects.set(key, { body: text, contentType: contentType ?? "application/octet-stream" });
        return {};
      },
      async head(key: string) {
        const artifact = objects.get(key);
        if (!artifact) return null;
        return {
          size: artifact.size ?? new TextEncoder().encode(artifact.body).byteLength,
          uploaded: new Date("2026-09-23T00:00:00.000Z"),
          httpEtag: '"fixture"',
          writeHttpMetadata(headers: Headers) { headers.set("Content-Type", artifact.contentType); },
        };
      },
      async get(key: string) {
        lookups.push(key);
        const artifact = objects.get(key) ?? { body: "private artifact", contentType: "application/json" };
        return {
          body: new Response(artifact.body).body,
          size: artifact.size ?? new TextEncoder().encode(artifact.body).byteLength,
          uploaded: new Date("2026-09-23T00:00:00.000Z"),
          httpEtag: '"fixture"',
          writeHttpMetadata(headers: Headers) { headers.set("Content-Type", artifact.contentType); },
        };
      },
      async list(options: R2ListOptions) {
        return {
          objects: [options.delimiter ? `${options.prefix}legacy.txt` : `${options.prefix}today.json`].map((key) => ({
            key,
            size: 16,
            uploaded: new Date("2026-09-23T00:00:00.000Z"),
            httpEtag: '"fixture"',
          })),
          delimitedPrefixes: options.delimiter
            ? [`${options.prefix}reports/`, `${options.prefix}notes/`]
            : [],
          truncated: false,
        };
      },
    },
  };
  return { env: env as never, uploads, lookups, objects };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://artifact.w3dev.app${path}`, init);
}

function seedWebContext(sqlite: import("bun:sqlite").Database): string {
  const now = Date.now();
  sqlite.exec(`
    INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at)
    VALUES ('user-1', 'Publisher', 'publisher@example.test', 1, NULL, ${now}, ${now});
    INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
    VALUES ('session-1', ${now + 3600000}, 'session-token-1', ${now}, ${now}, NULL, NULL, 'user-1');
    INSERT INTO teams (id, name, slug, created_at) VALUES ('team-abc123', 'W3Dev', 'w3dev', ${now});
    INSERT INTO team_slugs (slug, team_id, is_current, created_at, changed_at, changed_by_user_id)
    VALUES ('w3dev', 'team-abc123', 1, ${now}, NULL, NULL);
    INSERT INTO team_memberships (team_id, user_id, role, created_at)
    VALUES ('team-abc123', 'user-1', 'owner', ${now});
  `);
  return "session-token-1";
}

function seedArtifactShare(
  sqlite: import("bun:sqlite").Database,
  options: { artifactSlug?: string; token?: string; revokedAt?: number | null } = {},
): string {
  const artifactSlug = options.artifactSlug ?? "reports";
  const token = options.token ?? createArtifactShareToken();
  const now = Date.now();
  const artifactId = `artifact-${artifactSlug}`;
  sqlite.prepare("INSERT INTO artifacts (id, team_id, slug, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?)")
    .run(artifactId, "team-abc123", artifactSlug, now, now);
  sqlite.prepare("INSERT INTO artifact_shares (artifact_id, token, created_at, revoked_at) VALUES (?, ?, ?, ?)")
    .run(artifactId, token, now, options.revokedAt ?? null);
  return token;
}

async function signInPublisherWithTeam(
  sqlite: import("bun:sqlite").Database,
  env: ReturnType<typeof makeEnv>["env"],
  teamSlug = "w3dev",
): Promise<string> {
  (env as unknown as Record<string, unknown>).EMAIL = { send: async () => {} };
  const auth = createWebAuth(env as never);
  const signUp = await auth.api.signUpEmail({
    body: { name: "Publisher", email: "publisher@example.test", password: "sync-test-password" },
  });
  if (!signUp) throw new Error("expected signup to succeed");
  sqlite.exec("UPDATE user SET email_verified = 1 WHERE email = 'publisher@example.test'");
  const now = Date.now();
  const [member] = sqlite.prepare("SELECT id FROM user WHERE email = 'publisher@example.test'").all() as Array<{ id: string }>;
  sqlite.exec(`
    INSERT INTO teams (id, name, slug, created_at) VALUES ('team-abc123', 'W3Dev', '${teamSlug}', ${now});
    INSERT INTO team_slugs (slug, team_id, is_current, created_at, changed_at, changed_by_user_id)
    VALUES ('${teamSlug}', 'team-abc123', 1, ${now}, NULL, NULL);
    INSERT INTO team_memberships (team_id, user_id, role, created_at)
    VALUES ('team-abc123', '${member.id}', 'owner', ${now});
  `);
  const signIn = await auth.api.signInEmail({
    body: { email: "publisher@example.test", password: "sync-test-password" },
    asResponse: true,
  });
  const sessionCookie = signIn.headers.getSetCookie()
    .find((cookie) => cookie.startsWith("better-auth.session_token=") || cookie.startsWith("__Secure-better-auth.session_token="));
  if (!sessionCookie) throw new Error("expected a session cookie from sign-in");
  return sessionCookie.split(";")[0];
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
    const response = await worker.fetch(request("/__api/v1/uploads?artifact=reports&path=today.json", {
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
    const response = await worker.fetch(request("/__api/v1/uploads?artifact=reports&path=today.json", {
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
    const denied = await worker.fetch(request("/another-team/reports/private.json", {
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
    const contentSecurityPolicy = response.headers.get("Content-Security-Policy") ?? "";
    expect(contentSecurityPolicy).toContain("default-src 'none'");
    expect(contentSecurityPolicy).toContain("script-src 'self' 'unsafe-inline'");
    expect(contentSecurityPolicy).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(contentSecurityPolicy).toContain("img-src 'self' data: blob:");
    expect(contentSecurityPolicy).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("base-uri 'none'");
    expect(contentSecurityPolicy).toContain("form-action 'none'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("sandbox allow-scripts");
    expect(contentSecurityPolicy).not.toContain("allow-same-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("rejects flat root-level content paths", async () => {
    const { env, lookups } = makeEnv();
    const token = await accessToken();
    const response = await worker.fetch(request("/w3dev/today.json", {
      headers: { Authorization: `Bearer ${token.token}` },
    }), env);
    expect(response.status).toBe(404);
    expect(lookups).toEqual([]);
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
    expect(listing.headers.get("Cache-Control")).toBe("no-store");
    expect(await listing.json()).toMatchObject({
      team: "w3dev",
      artifacts: [{ slug: "reports" }, { slug: "notes" }],
      truncated: false,
      cursor: null,
    });

    const files = await worker.fetch(request("/__api/v1/artifacts/reports/files", {
      headers: { Authorization: `Bearer ${token.token}` },
    }), env);
    expect(files.status).toBe(200);
    expect(files.headers.get("Cache-Control")).toBe("no-store");
    expect(await files.json()).toMatchObject({
      team: "w3dev",
      artifact: "reports",
      files: [{ path: "today.json" }],
    });
  });

  it("validates artifact slugs and keeps the full upload key server-derived", async () => {
    const { env, uploads } = makeEnv();
    const token = await accessToken();
    const invalidSlug = await worker.fetch(request("/__api/v1/uploads?artifact=Bad_Name&path=today.json", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token.token}` },
      body: "{}",
    }), env);
    expect(invalidSlug.status).toBe(400);
    expect(uploads).toEqual([]);

    const invalidPath = await worker.fetch(request("/__api/v1/uploads?artifact=reports&path=..%2Fsecret", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token.token}` },
      body: "{}",
    }), env);
    expect(invalidPath.status).toBe(400);
    expect(uploads).toEqual([]);
  });

  it("serves provider-first login and protects protected routes", async () => {
    const { env } = makeEnv();
    const login = await worker.fetch(request("/auth/login"), env);
    expect(login.status).toBe(200);
    const loginHtml = await login.text();
    expect(loginHtml).toContain("Continue with GitHub");
    expect(loginHtml).toContain("Continue with email");
    expect(loginHtml).toContain('id="email-panel"');
    expect(loginHtml).toContain('hidden=""');
    expect(loginHtml).toContain('/assets/auth.js');
    expect(loginHtml).not.toContain(JWT_SECRET);
    expect(login.headers.get("Cache-Control")).toBe("no-store");
    expect(login.headers.get("Content-Security-Policy")).not.toContain("unsafe-inline");

    const script = await worker.fetch(request("/assets/auth.js"), env);
    expect(script.status).toBe(200);
    expect(script.headers.get("Content-Type")).toContain("text/javascript");
    const scriptBody = await script.text();
    expect(scriptBody).toContain("sign-up/email");
    expect(scriptBody).toContain("sign-in/social");

    const tokens = await worker.fetch(request("/settings/api-tokens"), env);
    expect(tokens.status).toBe(302);
    expect(tokens.headers.get("Location")).toContain("returnTo=%2Fsettings%2Fapi-tokens");

    const device = await worker.fetch(request("/auth/device"), env);
    expect(device.status).toBe(302);
    expect(device.headers.get("Location")).toContain("returnTo=%2Fauth%2Fdevice");

    const dashboard = await worker.fetch(request("/dashboard"), env);
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.get("Location")).toContain("returnTo=%2Fdashboard");

    const root = await worker.fetch(request("/"), env);
    expect(root.status).toBe(302);
    expect(root.headers.get("Location")).toContain("returnTo=%2Fdashboard");
  });

  it("signs out through Better Auth and rejects cross-origin dashboard mutations", async () => {
    const { env } = makeEnv();
    const logout = await worker.fetch(request("/auth/logout", {
      method: "POST",
      headers: { Origin: "https://artifact.w3dev.app" },
    }), env);
    expect(logout.status).toBe(303);
    expect(logout.headers.get("Location")).toBe("/auth/login");
    expect(logout.headers.get("Cache-Control")).toBe("no-store");

    const mutation = await worker.fetch(request("/dashboard/team-1/settings/api-tokens/revoke", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "tokenId=api_12345678-1234-4234-9234-123456789abc",
    }), env);
    expect(mutation.status).toBe(403);

    const opaque = await worker.fetch(request("/dashboard/team-1/settings/api-tokens/revoke", {
      method: "POST",
      headers: {
        Origin: "null",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "tokenId=api_12345678-1234-4234-9234-123456789abc",
    }), env);
    expect(opaque.status).toBe(403);
    expect(await opaque.text()).toBe("Forbidden");
  });

  it("forwards a trusted origin so Better Auth invalidates the dashboard session", async () => {
    const { sqlite, db } = createMigratedDb();
    const { env } = makeEnv(db);
    (env as unknown as Record<string, unknown>).EMAIL = { send: async () => {} };
    const auth = createWebAuth(env);
    const signUp = await auth.api.signUpEmail({
      body: { name: "Publisher", email: "publisher@example.test", password: "sync-test-password" },
    });
    if (!signUp) throw new Error("expected signup to succeed");
    sqlite.exec("UPDATE user SET email_verified = 1 WHERE email = 'publisher@example.test'");
    const signIn = await auth.api.signInEmail({
      body: { email: "publisher@example.test", password: "sync-test-password" },
      asResponse: true,
    });
    const sessionCookie = signIn.headers.getSetCookie()
      .find((cookie) => cookie.startsWith("better-auth.session_token=") || cookie.startsWith("__Secure-better-auth.session_token="));
    if (!sessionCookie) throw new Error("expected a session cookie from sign-in");
    const sessionCookiePair = sessionCookie.split(";")[0];

    const logout = await worker.fetch(request("/auth/logout", {
      method: "POST",
      headers: {
        Origin: "https://artifact.w3dev.app",
        Cookie: sessionCookiePair,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    }), env);

    expect(logout.status).toBe(303);
    expect(logout.headers.get("Location")).toBe("/auth/login");
    expect(await auth.api.getSession({ headers: new Headers({ Cookie: sessionCookiePair }) })).toBeNull();
  });

  it("replaces untrusted return paths with the safe dashboard fallback", async () => {
    const { env } = makeEnv();
    const login = await worker.fetch(request("/auth/login?returnTo=%2F%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E"), env);
    const html = await login.text();

    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain('data-return-to="/dashboard"');
  });

  it("seeds a partitioned embed cookie on session-authenticated iframe artifact loads", async () => {
    const { sqlite, db } = createMigratedDb();
    const { env } = makeEnv(db);
    const sessionCookiePair = await signInPublisherWithTeam(sqlite, env);
    const response = await serveArtifact(request("/w3dev/reports/today.json", {
      headers: {
        Cookie: sessionCookiePair,
        "Sec-Fetch-Dest": "iframe",
      },
    }), env as never, "w3dev");

    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.length).toBe(1);
    expect(setCookies[0]).toContain("artifact_embed=");
    expect(setCookies[0]).toContain("HttpOnly");
    expect(setCookies[0]).toContain("Secure");
    expect(setCookies[0]).toContain("SameSite=None");
    expect(setCookies[0]).toContain("Partitioned");
    const token = /artifact_embed=([^;]+)/.exec(setCookies[0])![1];
    expect(await verifyEmbedToken({ JWT_SECRET } as never, token)).toEqual({
      teamId: "team-abc123",
      artifactSlug: "reports",
    });
  });

  it("serves artifact assets from the embed cookie without a session", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    const { env } = makeEnv(db);
    const embed = await issueEmbedToken({ JWT_SECRET } as never, "team-abc123");
    const response = await serveArtifact(request("/w3dev/reports/today.json", {
      headers: {
        Cookie: `artifact_embed=${embed.token}`,
        "Sec-Fetch-Dest": "style",
      },
    }), env, "w3dev");

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("accepts an embed token query parameter and seeds the partitioned cookie", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    const { env } = makeEnv(db);
    const embed = await issueEmbedToken({ JWT_SECRET } as never, "team-abc123");
    const response = await serveArtifact(request(`/w3dev/reports/today.json?token=${embed.token}`, {
      headers: { "Sec-Fetch-Dest": "style" },
    }), env, "w3dev");

    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.length).toBe(1);
    expect(setCookies[0]).toContain("artifact_embed=");
    expect(setCookies[0]).toContain("Partitioned");
  });

  it("passes an explicit embed token to same-artifact HTML and CSS helpers", async () => {
    const { sqlite, db } = createMigratedDb();
    const sessionToken = seedWebContext(sqlite);
    const { env, objects } = makeEnv(db);
    const embed = await issueEmbedToken({ JWT_SECRET } as never, "team-abc123");
    objects.set("uploads/team-abc123/artifacts/reports/schemes/04/index.html", {
      body: '<link rel="stylesheet" href="site.css"><script src="./helper.js"></script><img src="/w3dev/reports/images/logo.svg"><a href="next.html">Next</a><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Example"><style>.hero{background:url("images/inline.svg")}</style>',
      contentType: "text/html; charset=utf-8",
    });
    objects.set("uploads/team-abc123/artifacts/reports/schemes/04/site.css", {
      body: '@import "./theme.css"; .hero{background:url("../images/hero.svg")} .remote{background:url(https://cdn.example.test/image.svg)}',
      contentType: "text/css; charset=utf-8",
    });

    const htmlResponse = await serveArtifact(request(`/w3dev/reports/schemes/04/index.html?token=${embed.token}`, {
      headers: { Cookie: `better-auth.session_token=${sessionToken}; __Secure-better-auth.session_token=${sessionToken}` },
    }), env, "w3dev");
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain(`href="/w3dev/reports/schemes/04/site.css?token=${embed.token}"`);
    expect(html).toContain(`src="/w3dev/reports/schemes/04/helper.js?token=${embed.token}"`);
    expect(html).toContain(`src="/w3dev/reports/images/logo.svg?token=${embed.token}"`);
    expect(html).toContain('href="https://fonts.googleapis.com/css2?family=Example"');
    expect(html).toContain('href="next.html"');
    expect(html).toContain(`images/inline.svg?token=${embed.token}`);

    const cssResponse = await serveArtifact(request(`/w3dev/reports/schemes/04/site.css?token=${embed.token}`), env, "w3dev");
    const css = await cssResponse.text();
    expect(cssResponse.status).toBe(200);
    expect(css).toContain(`@import "/w3dev/reports/schemes/04/theme.css?token=${embed.token}"`);
    expect(css).toContain(`/w3dev/reports/schemes/images/hero.svg?token=${embed.token}`);
    expect(css).toContain("url(https://cdn.example.test/image.svg)");
  });

  it("rewrites session-authenticated HTML and linked CSS with an artifact-scoped token", async () => {
    const { sqlite, db } = createMigratedDb();
    const { env, objects } = makeEnv(db);
    const teamSlug = "ashutosh-kumar-yaaawkla";
    const artifactSlug = "w3dev-us-design-proposal";
    const sessionCookie = await signInPublisherWithTeam(sqlite, env, teamSlug);
    objects.set(`uploads/team-abc123/artifacts/${artifactSlug}/schemes/01-editorial/index.html`, {
      body: '<link rel="stylesheet" href="site.css">',
      contentType: "text/html; charset=utf-8",
    });
    objects.set(`uploads/team-abc123/artifacts/${artifactSlug}/schemes/01-editorial/site.css`, {
      body: '@import "./theme.css"; .hero{background:url("../images/hero.svg")}',
      contentType: "text/css; charset=utf-8",
    });

    const htmlResponse = await serveArtifact(request(`/${teamSlug}/${artifactSlug}/schemes/01-editorial/index.html`, {
      headers: { Cookie: sessionCookie },
    }), env, teamSlug);
    const html = await htmlResponse.text();
    const token = /site\.css\?token=([^"&]+)/.exec(html)?.[1];

    expect(htmlResponse.status).toBe(200);
    expect(token).toBeTruthy();
    expect(await verifyEmbedToken({ JWT_SECRET } as never, token!)).toEqual({
      teamId: "team-abc123",
      artifactSlug,
    });
    expect(htmlResponse.headers.getSetCookie()[0]).toContain(`artifact_embed=${token}`);

    const cssResponse = await serveArtifact(request(`/${teamSlug}/${artifactSlug}/schemes/01-editorial/site.css?token=${token}`), env, teamSlug);
    const css = await cssResponse.text();
    expect(cssResponse.status).toBe(200);
    expect(css).toContain(`@import "/${teamSlug}/${artifactSlug}/schemes/01-editorial/theme.css?token=${token}"`);
    expect(css).toContain(`/${teamSlug}/${artifactSlug}/schemes/images/hero.svg?token=${token}`);

    const otherArtifact = await serveArtifact(request(`/${teamSlug}/other-artifact/today.json?token=${token}`), env, teamSlug);
    expect(otherArtifact.status).toBe(401);
  });

  it("serves shared HTML, CSS, and assets with scoped URLs and public isolation headers", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    const { env, objects, lookups } = makeEnv(db);
    const shareToken = seedArtifactShare(sqlite);
    objects.set("uploads/team-abc123/artifacts/reports/index.html", {
      body: '<link rel="stylesheet" href="styles/site.css?mode=dark"><script type="module" src="./helper.js"></script><img srcset="data:image/svg+xml,%3Csvg%3E 1x, /w3dev/reports/images/b.png 2x"><div style=\'background:url("images/inline.svg");mask-image:url(data:image/svg+xml,%3Csvg%3E)\'></div><a href="next.html#part">Next</a><a href="/w3dev/reports/next.html?from=index">Root next</a><a href="/w3dev/sibling/index.html">Sibling</a><a href="https://cdn.example.test/page">External</a>',
      contentType: "text/html; charset=utf-8",
    });
    objects.set("uploads/team-abc123/artifacts/reports/styles/site.css", {
      body: '@import "./theme.css"; .hero{background:url("../images/hero.svg")} .remote{background:url(https://cdn.example.test/image.svg)} .sibling{background:url("/w3dev/other/image.svg")}',
      contentType: "text/css; charset=utf-8",
    });
    objects.set("uploads/team-abc123/artifacts/reports/helper.js", {
      body: "export const ready = true;",
      contentType: "text/javascript; charset=utf-8",
    });

    const htmlResponse = await serveArtifact(request(`/w3dev/reports/index.html?share=${shareToken}`), env, "w3dev");
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain(`href="/w3dev/reports/styles/site.css?mode=dark&amp;share=${shareToken}"`);
    expect(html).toContain(`src="/w3dev/reports/helper.js?share=${shareToken}"`);
    expect(html).toContain(`srcset="data:image/svg+xml,%3Csvg%3E 1x, /w3dev/reports/images/b.png?share=${shareToken} 2x"`);
    expect(html).toContain(`/w3dev/reports/images/b.png?share=${shareToken} 2x`);
    expect(html).toContain(`style='background:url("/w3dev/reports/images/inline.svg?share=${shareToken}");mask-image:url(data:image/svg+xml,%3Csvg%3E)'`);
    expect(html).toContain(`href="/w3dev/reports/next.html?share=${shareToken}#part"`);
    expect(html).toContain(`href="/w3dev/reports/next.html?from=index&amp;share=${shareToken}"`);
    expect(html).toContain('href="/w3dev/sibling/index.html"');
    expect(html).toContain('href="https://cdn.example.test/page"');
    expect(htmlResponse.headers.get("Cache-Control")).toBe("private, no-store");
    expect(htmlResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(htmlResponse.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(htmlResponse.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(htmlResponse.headers.get("Set-Cookie")).toBeNull();
    expect(htmlResponse.headers.get("Content-Security-Policy")).toContain("sandbox allow-scripts");
    expect(htmlResponse.headers.get("Content-Security-Policy")).toContain("connect-src *");

    const cssResponse = await serveArtifact(request(`/w3dev/reports/styles/site.css?share=${shareToken}`), env, "w3dev");
    const css = await cssResponse.text();
    expect(cssResponse.status).toBe(200);
    expect(css).toContain(`@import "/w3dev/reports/styles/theme.css?share=${shareToken}"`);
    expect(css).toContain(`/w3dev/reports/images/hero.svg?share=${shareToken}`);
    expect(css).toContain("url(https://cdn.example.test/image.svg)");
    expect(css).toContain('url("/w3dev/other/image.svg")');

    const helperResponse = await serveArtifact(request(`/w3dev/reports/helper.js?share=${shareToken}`), env, "w3dev");
    expect(helperResponse.status).toBe(200);
    expect(await helperResponse.text()).toContain("ready");
    expect(helperResponse.headers.get("Set-Cookie")).toBeNull();
    expect(lookups).toEqual([
      "uploads/team-abc123/artifacts/reports/index.html",
      "uploads/team-abc123/artifacts/reports/styles/site.css",
      "uploads/team-abc123/artifacts/reports/helper.js",
    ]);
  });

  it("fails closed for malformed, revoked, foreign, sibling, and traversal share requests before R2", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    const { env, lookups } = makeEnv(db);
    const activeToken = seedArtifactShare(sqlite);
    const revokedToken = seedArtifactShare(sqlite, { artifactSlug: "old", revokedAt: Date.now() });

    const responses = await Promise.all([
      serveArtifact(request("/w3dev/reports/index.html?share=too-short"), env, "w3dev"),
      serveArtifact(request(`/w3dev/old/index.html?share=${revokedToken}`), env, "w3dev"),
      serveArtifact(request(`/another-team/reports/index.html?share=${activeToken}`), env, "another-team"),
      serveArtifact(request(`/w3dev/sibling/index.html?share=${activeToken}`), env, "w3dev"),
      serveArtifact(request(`/w3dev/reports/%2e%2e/secret?share=${activeToken}`), env, "w3dev"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
    expect(responses.every((response) => response.headers.get("Cache-Control") === "no-store")).toBe(true);
    expect(responses.every((response) => response.headers.get("Referrer-Policy") === "no-referrer")).toBe(true);
    expect(lookups).toEqual([]);
  });

  it("bounds shared HTML and CSS rewriting by the declared object size", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    const { env } = makeEnv(db);
    const shareToken = seedArtifactShare(sqlite);
    const oversized = 4 * 1024 * 1024 + 1;
    (env as unknown as { ARTIFACTS_BUCKET: { get: (key: string) => Promise<unknown> } }).ARTIFACTS_BUCKET = {
      async get(key: string) {
        const contentType = key.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
        return {
          body: new Response("small body").body,
          size: oversized,
          httpEtag: '"oversized"',
          writeHttpMetadata(headers: Headers) { headers.set("Content-Type", contentType); },
        };
      },
    } as never;

    for (const path of ["index.html", "site.css"]) {
      const response = await serveArtifact(request(`/w3dev/reports/${path}?share=${shareToken}`), env, "w3dev");
      expect(response.status).toBe(413);
      const body = await response.json() as unknown as { error: string };
      expect(body).toEqual({ error: "artifact_content_too_large" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
  });

  it("keeps an enabled link live for uploads and blocks it immediately after revoke", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    const { env, objects, lookups } = makeEnv(db);
    const shareToken = seedArtifactShare(sqlite);
    objects.set("uploads/team-abc123/artifacts/reports/index.html", {
      body: "initial",
      contentType: "text/html; charset=utf-8",
    });

    const initial = await serveArtifact(request(`/w3dev/reports/index.html?share=${shareToken}`), env, "w3dev");
    expect(initial.status).toBe(200);
    expect(await initial.text()).toBe("initial");

    const publisher = await accessToken();
    const upload = await uploadArtifact(request("/__api/v1/uploads?artifact=reports&path=live.json", {
      method: "PUT",
      headers: { Authorization: `Bearer ${publisher.token}`, "Content-Type": "application/json" },
      body: '{"live":true}',
    }), env);
    expect(upload.status).toBe(201);
    const live = await serveArtifact(request(`/w3dev/reports/live.json?share=${shareToken}`), env, "w3dev");
    expect(live.status).toBe(200);
    expect(await live.text()).toBe('{"live":true}');
    expect(sqlite.prepare("SELECT revoked_at FROM artifact_shares WHERE token = ?").get(shareToken)).toEqual({ revoked_at: null });

    sqlite.prepare("UPDATE artifact_shares SET revoked_at = ? WHERE token = ?").run(Date.now(), shareToken);
    const revoked = await serveArtifact(request(`/w3dev/reports/index.html?share=${shareToken}`), env, "w3dev");
    expect(revoked.status).toBe(404);
    expect(lookups).toEqual([
      "uploads/team-abc123/artifacts/reports/index.html",
      "uploads/team-abc123/artifacts/reports/live.json",
    ]);
  });

  it("keeps the legacy 24-hour embed capability separate from revocable share links", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    const { env, objects } = makeEnv(db);
    const shareToken = seedArtifactShare(sqlite);
    objects.set("uploads/team-abc123/artifacts/reports/index.html", {
      body: "legacy embed",
      contentType: "text/html; charset=utf-8",
    });
    const embed = await issueEmbedToken({ JWT_SECRET } as never, "team-abc123");

    sqlite.prepare("UPDATE artifact_shares SET revoked_at = ? WHERE token = ?").run(Date.now(), shareToken);
    const legacy = await serveArtifact(request(`/w3dev/reports/index.html?token=${embed.token}`), env, "w3dev");
    expect(legacy.status).toBe(200);
    expect(await legacy.text()).toBe("legacy embed");
    expect(legacy.headers.getSetCookie().length).toBe(1);
  });

  it("preserves a share query while redirecting historical team slugs", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    sqlite.prepare("INSERT INTO team_slugs (slug, team_id, is_current, created_at, changed_at, changed_by_user_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run("old-w3dev", "team-abc123", 0, Date.now(), Date.now(), "user-1");
    const { env } = makeEnv(db);
    const shareToken = seedArtifactShare(sqlite);
    const response = await serveArtifact(request(`/old-w3dev/reports/index.html?share=${shareToken}&view=full`), env, "old-w3dev");

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(`https://artifact.w3dev.app/w3dev/reports/index.html?share=${shareToken}&view=full`);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("requires strict CSRF and an owner role for dashboard share mutations", async () => {
    const { sqlite, db } = createMigratedDb();
    const { env, objects } = makeEnv(db);
    const sessionCookie = await signInPublisherWithTeam(sqlite, env);
    const sessionToken = decodeURIComponent(sessionCookie.slice(sessionCookie.indexOf("=") + 1)).split(".", 1)[0];
    const csrfToken = await issueDashboardCsrfToken("test-better-auth-secret-that-is-long-enough", sessionToken);
    const shareToken = seedArtifactShare(sqlite);
    objects.set("uploads/team-abc123/artifacts/reports/index.html", {
      body: "dashboard share",
      contentType: "text/html; charset=utf-8",
    });

    const postShare = (options: { csrfToken?: string; origin?: string; action?: string } = {}) => {
      const form = new URLSearchParams({
        action: options.action ?? "enable",
        context: "detail",
        csrfToken: options.csrfToken ?? csrfToken,
      });
      return worker.fetch(request("/dashboard/team-abc123/artifacts/reports/share", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: options.origin ?? "https://artifact.w3dev.app",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      }), env);
    };

    expect((await postShare({ origin: "https://attacker.example" })).status).toBe(403);
    expect((await postShare({ csrfToken: "invalid" })).status).toBe(403);
    const enabled = await postShare();
    expect(enabled.status).toBe(303);
    expect(enabled.headers.get("Location")).toContain("share=enabled");
    expect(sqlite.prepare("SELECT token, revoked_at FROM artifact_shares WHERE artifact_id = ?").get("artifact-reports"))
      .toEqual({ token: shareToken, revoked_at: null });

    for (const role of ["admin", "member"] as const) {
      sqlite.prepare("UPDATE team_memberships SET role = ? WHERE team_id = ?").run(role, "team-abc123");
      expect((await postShare({ action: "revoke" })).status).toBe(403);
      expect(sqlite.prepare("SELECT revoked_at FROM artifact_shares WHERE artifact_id = ?").get("artifact-reports"))
        .toEqual({ revoked_at: null });
      sqlite.prepare("UPDATE team_memberships SET role = 'owner' WHERE team_id = ?").run("team-abc123");
    }

    const revoked = await postShare({ action: "revoke" });
    expect(revoked.status).toBe(303);
    expect(revoked.headers.get("Location")).toContain("share=revoked");
    expect(sqlite.prepare("SELECT revoked_at FROM artifact_shares WHERE artifact_id = ?").get("artifact-reports")).not.toEqual({ revoked_at: null });
  });

  it("rejects embed credentials from another team, expired tokens, or absent credentials", async () => {
    const { sqlite, db } = createMigratedDb();
    seedWebContext(sqlite);
    const { env } = makeEnv(db);

    const foreign = await issueEmbedToken({ JWT_SECRET } as never, "team-other");
    const foreignResponse = await serveArtifact(request(`/w3dev/reports/today.json?token=${foreign.token}`), env, "w3dev");
    expect(foreignResponse.status).toBe(401);

    const expired = await issueEmbedToken({ JWT_SECRET } as never, "team-abc123", Math.floor(Date.now() / 1000) - 25 * 60 * 60);
    const expiredResponse = await serveArtifact(request(`/w3dev/reports/today.json?token=${expired.token}`), env, "w3dev");
    expect(expiredResponse.status).toBe(401);

    const anonymous = await serveArtifact(request("/w3dev/reports/today.json"), env, "w3dev");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).toBe(JSON.stringify({ error: "web_session_required" }));
  });

  it("mints team-scoped embed tokens for API credentials and rejects anonymous callers", async () => {
    const { env } = makeEnv();
    const denied = await worker.fetch(request("/__api/v1/artifacts/embed-token", { method: "POST" }), env);
    expect(denied.status).toBe(401);

    const token = await accessToken();
    const minted = await worker.fetch(request("/__api/v1/artifacts/embed-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.token}` },
    }), env);
    expect(minted.status).toBe(200);
    const payload = await minted.json() as Record<string, unknown>;
    expect(payload.team).toBe("w3dev");
    expect(typeof payload.token).toBe("string");
    expect(await verifyEmbedToken({ JWT_SECRET } as never, payload.token as string)).toEqual({ teamId: "team-abc123" });
    expect(typeof payload.expiresAt).toBe("string");
  });

  it("preserves multiple authentication cookies while adding no-store headers", () => {
    const original = new Response("ok", {
      headers: [
        ["Content-Type", "application/json"],
        ["Set-Cookie", "session=one; Path=/; HttpOnly; Secure; SameSite=Lax"],
        ["Set-Cookie", "oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"],
      ],
    });

    const response = withNoStore(original);
    expect(response.headers.getSetCookie()).toEqual([
      "session=one; Path=/; HttpOnly; Secure; SameSite=Lax",
      "oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    ]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });
});
