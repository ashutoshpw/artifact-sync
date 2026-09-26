import { and, eq } from "drizzle-orm";
import { authenticate, authError, noStoreHeaders } from "../auth/middleware.ts";
import { EMBED_COOKIE, embedCookieHeader, findEmbedCredential, issueEmbedToken } from "../auth/embed.ts";
import { isValidTeamSlug } from "../auth/team-slug.ts";
import { PUBLISH_PERMISSION, READ_PERMISSION } from "../auth/types.ts";
import type { GatewayEnv, PublisherIdentity } from "../auth/types.ts";
import { getWebIdentity } from "../auth/web-session.ts";
import { createDatabase } from "../db/client.ts";
import { artifacts, teamMemberships, teamSlugs, teams } from "../db/schema.ts";
const MAX_PATH_LENGTH = 1024;
const ARTIFACT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "sandbox allow-scripts",
].join("; ");

export async function uploadArtifact(request: Request, env: GatewayEnv): Promise<Response> {
  const context = await authenticate(request, env);
  if (context instanceof Response) return context;
  if (!context.identity.permissions.includes(PUBLISH_PERMISSION)) return authError(403, "publish_permission_required");

  const url = new URL(request.url);
  const artifactSlug = url.searchParams.get("artifact");
  const relativePath = safeRelativePath(url.searchParams.get("path"));
  if (!artifactSlug || !isValidTeamSlug(artifactSlug) || !relativePath || !request.body) {
    return authError(400, "invalid_artifact_slug_path_or_body");
  }

  const key = `uploads/${context.identity.teamId}/artifacts/${artifactSlug}/${relativePath}`;
  try {
    await env.ARTIFACTS_BUCKET.put(key, request.body, {
      httpMetadata: { contentType: contentTypeForPath(relativePath) },
    });
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
  // Best-effort metadata sync: R2 remains the source of truth, so a metadata
  // failure never fails the upload. The dashboard reconciles missing rows.
  const db = env.DB;
  if (db && typeof (db as { prepare?: unknown }).prepare === "function") {
    try {
      const now = new Date();
      await createDatabase(db).insert(artifacts)
        .values({
          id: crypto.randomUUID(),
          teamId: context.identity.teamId,
          slug: artifactSlug,
          createdAt: now,
          lastActivityAt: now,
        })
        .onConflictDoUpdate({
          target: [artifacts.teamId, artifacts.slug],
          set: { lastActivityAt: now },
        });
    } catch (error) {
      console.error("artifact metadata sync failed", error);
    }
  }
  return Response.json({ artifact: artifactSlug, path: relativePath }, { status: 201, headers: noStoreHeaders() });
}

export async function listArtifacts(request: Request, env: GatewayEnv): Promise<Response> {
  const url = new URL(request.url);
  const requestedTeam = url.searchParams.get("team");
  const access = await resolveTeamAccess(request, env, requestedTeam, READ_PERMISSION);
  if (access instanceof Response) return access;

  const prefix = `uploads/${access.teamId}/artifacts/`;
  const requestedLimit = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  try {
    const result = await env.ARTIFACTS_BUCKET.list({ prefix, delimiter: "/", limit, cursor });
    const artifacts = result.delimitedPrefixes.flatMap((delimitedPrefix) => {
      if (!delimitedPrefix.startsWith(prefix)) return [];
      const slug = delimitedPrefix.slice(prefix.length).replace(/\/$/u, "");
      return isValidTeamSlug(slug) ? [{ slug }] : [];
    });
    return Response.json({ team: access.team, artifacts, truncated: result.truncated, cursor: result.truncated ? result.cursor : null }, {
      headers: noStoreHeaders(),
    });
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
}

export async function listArtifactFiles(
  request: Request,
  env: GatewayEnv,
  artifactSlug: string,
): Promise<Response> {
  const url = new URL(request.url);
  const access = await resolveTeamAccess(request, env, url.searchParams.get("team"), READ_PERMISSION);
  if (access instanceof Response) return access;
  if (!isValidTeamSlug(artifactSlug)) return new Response("Not found", { status: 404, headers: noStoreHeaders() });

  const prefix = `uploads/${access.teamId}/artifacts/${artifactSlug}/`;
  const requestedLimit = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  try {
    const result = await env.ARTIFACTS_BUCKET.list({ prefix, limit, cursor });
    if (result.objects.length === 0 && !cursor) return authError(404, "artifact_not_found");
    const files = result.objects.map((object) => ({
      path: object.key.slice(prefix.length),
      size: object.size,
      uploadedAt: object.uploaded.toISOString(),
      etag: object.httpEtag,
    }));
    return Response.json({
      team: access.team,
      artifact: artifactSlug,
      files,
      truncated: result.truncated,
      cursor: result.truncated ? result.cursor : null,
    }, { headers: noStoreHeaders() });
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
}

export async function serveArtifact(request: Request, env: GatewayEnv, teamSlug: string): Promise<Response> {
  if (!isValidTeamSlug(teamSlug)) return new Response("Not found", { status: 404, headers: noStoreHeaders() });
  const requestUrl = new URL(request.url);
  const rawRelative = requestUrl.pathname.slice(teamSlug.length + 2);
  const relativePath = safeRelativePath(rawRelative.split("/").map(decodePathPart).join("/"));
  if (!relativePath) return new Response("Not found", { status: 404, headers: noStoreHeaders() });
  const [artifactSlug, ...filePathParts] = relativePath.split("/");
  if (!isValidTeamSlug(artifactSlug) || filePathParts.length === 0) {
    return new Response("Not found", { status: 404, headers: noStoreHeaders() });
  }
  const artifactPath = filePathParts.join("/");

  let access: { teamId: string; team: string } | Response;
  let embedCookie: string | null = null;
  let embedToken: string | null = null;
  if (request.headers.has("Authorization")) {
    access = await resolveTeamAccess(request, env, teamSlug, READ_PERMISSION);
    if (access instanceof Response) {
      const scope = await lookupTeamSlugScope(env, teamSlug);
      if (scope instanceof Response) return access.status === 401 || access.status === 403 ? access : scope;
      if (!scope) return access;
      access = await resolveTeamAccess(request, env, teamSlug, READ_PERMISSION, scope.teamId);
      if (access instanceof Response) return access;
    }
  } else {
    const scope = await lookupTeamSlugScope(env, teamSlug);
    if (scope instanceof Response) return scope;
    if (!scope) return new Response("Not found", { status: 404, headers: noStoreHeaders() });
    if (!scope.isCurrent) {
      requestUrl.pathname = `/${scope.currentSlug}${rawRelative ? `/${rawRelative}` : ""}`;
      return Response.redirect(requestUrl, 308);
    }
    access = await resolveTeamAccess(request, env, teamSlug, READ_PERMISSION, scope.teamId);
    if (access instanceof Response) {
      // Cross-site embeds withhold the session cookie from subresource requests
      // (third-party cookie enforcement), so an embedded artifact document can
      // load while its relative assets get 401s. Accept a short-lived embed
      // credential minted for this team instead.
      const credential = await findEmbedCredential(request, env, scope.teamId);
      if (!credential) return access;
      access = { teamId: scope.teamId, team: scope.currentSlug };
      if (credential === "query") {
        embedToken = requestUrl.searchParams.get("token");
        if (embedToken) embedCookie = embedToken;
      }
    } else {
      const credential = await findEmbedCredential(request, env, scope.teamId);
      if (credential === "query") {
        embedToken = requestUrl.searchParams.get("token");
        if (embedToken) embedCookie = embedToken;
      } else if (!credential) {
        // Any session-authenticated artifact request that did not present a
        // valid embed credential seeds one, so assets requested from embed
        // contexts the browser grants document access to keep working.
        embedCookie = (await issueEmbedToken(env, scope.teamId)).token;
      }
    }
  }

  try {
    const object = await env.ARTIFACTS_BUCKET.get(`uploads/${access.teamId}/artifacts/${artifactSlug}/${artifactPath}`);
    if (!object) return new Response("Not found", { status: 404, headers: noStoreHeaders() });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", ARTIFACT_CONTENT_SECURITY_POLICY);
    headers.set("Referrer-Policy", "no-referrer");
    if (embedCookie) headers.append("Set-Cookie", embedCookieHeader(embedCookie));
    let body: BodyInit | null = object.body;
    const contentType = headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (embedToken && contentType === "text/html") {
      body = rewriteArtifactHtml(await new Response(object.body).text(), requestUrl, teamSlug, artifactSlug, embedToken);
      headers.delete("Content-Encoding");
      headers.delete("Content-Length");
    } else if (embedToken && contentType === "text/css") {
      body = rewriteArtifactCss(await new Response(object.body).text(), requestUrl, teamSlug, artifactSlug, embedToken);
      headers.delete("Content-Encoding");
      headers.delete("Content-Length");
    }
    return new Response(body, { headers });
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
}

function rewriteArtifactHtml(
  html: string,
  requestUrl: URL,
  teamSlug: string,
  artifactSlug: string,
  token: string,
): string {
  const resourceTagPattern = /<(?:link|script|img|source|audio|video|track|iframe|embed|object|input)\b[^>]*>/giu;
  const rewritten = html.replace(resourceTagPattern, (tag) => {
    const tagName = /^<([a-z]+)/iu.exec(tag)?.[1].toLowerCase();
    const attributes = tagName === "link" ? "href" : tagName === "object" ? "data" : "src|poster";
    const attributePattern = new RegExp(`(\\s(?:${attributes})\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, "giu");
    return tag.replace(attributePattern, (_match, prefix: string, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
      const rewrittenValue = appendArtifactToken(value.replace(/&amp;/giu, "&"), requestUrl, teamSlug, artifactSlug, token)
        .replaceAll("&", "&amp;");
      if (doubleQuoted !== undefined) return `${prefix}"${rewrittenValue}"`;
      if (singleQuoted !== undefined) return `${prefix}'${rewrittenValue}'`;
      return `${prefix}${rewrittenValue}`;
    });
  });
  return rewritten.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/giu, (_match, open: string, css: string, close: string) =>
    `${open}${rewriteArtifactCss(css, requestUrl, teamSlug, artifactSlug, token)}${close}`,
  );
}

function rewriteArtifactCss(
  css: string,
  requestUrl: URL,
  teamSlug: string,
  artifactSlug: string,
  token: string,
): string {
  const rewriteValue = (value: string) => appendArtifactToken(value.trim(), requestUrl, teamSlug, artifactSlug, token);
  const withUrls = css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/giu, (match, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
    const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
    const rewritten = rewriteValue(value);
    if (doubleQuoted !== undefined) return `url("${rewritten}")`;
    if (singleQuoted !== undefined) return `url('${rewritten}')`;
    return `url(${rewritten})`;
  });
  return withUrls.replace(/(@import\s+)("([^"]*)"|'([^']*)')/giu, (_match, prefix: string, quoted: string, doubleQuoted?: string, singleQuoted?: string) => {
    const value = doubleQuoted ?? singleQuoted ?? "";
    const rewritten = rewriteValue(value);
    return `${prefix}${quoted[0]}${rewritten}${quoted[0]}`;
  });
}

function appendArtifactToken(value: string, requestUrl: URL, teamSlug: string, artifactSlug: string, token: string): string {
  if (!value || value.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(value)) return value;
  try {
    const resolved = new URL(value, requestUrl);
    const artifactPrefix = `/${teamSlug}/${artifactSlug}/`;
    // A shared token must not escape to external URLs or another artifact.
    if (resolved.origin !== requestUrl.origin || !resolved.pathname.startsWith(artifactPrefix)) return value;
    resolved.searchParams.set("token", token);
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return value;
  }
}

export async function createEmbedToken(request: Request, env: GatewayEnv): Promise<Response> {
  const url = new URL(request.url);
  const access = await resolveTeamAccess(request, env, url.searchParams.get("team"), READ_PERMISSION);
  if (access instanceof Response) return access;
  const { token, expiresAt } = await issueEmbedToken(env, access.teamId);
  return Response.json({ team: access.team, token, expiresAt }, { headers: noStoreHeaders() });
}

async function lookupTeamSlugScope(
  env: GatewayEnv,
  teamSlug: string,
): Promise<{ teamId: string; currentSlug: string; isCurrent: boolean } | Response | undefined> {
  try {
    const db = createDatabase(env.DB);
    const [scope] = await db.select({ teamId: teamSlugs.teamId, currentSlug: teams.slug, isCurrent: teamSlugs.isCurrent })
      .from(teamSlugs)
      .innerJoin(teams, eq(teamSlugs.teamId, teams.id))
      .where(eq(teamSlugs.slug, teamSlug))
      .limit(1);
    return scope;
  } catch {
    return authError(503, "identity_service_unavailable");
  }
}

async function resolveTeamAccess(
  request: Request,
  env: GatewayEnv,
  requestedTeam: string | null,
  permission: string,
  expectedTeamId?: string,
): Promise<{ teamId: string; team: string } | Response> {
  if (request.headers.has("Authorization")) {
    const context = await authenticate(request, env);
    if (context instanceof Response) return context;
    if (!context.identity.permissions.includes(permission)) return authError(403, "artifact_permission_required");
    if (expectedTeamId && expectedTeamId !== context.identity.teamId) return authError(403, "team_access_required");
    if (!expectedTeamId && requestedTeam && requestedTeam !== context.identity.team) return authError(403, "team_access_required");
    return { teamId: context.identity.teamId, team: context.identity.team };
  }

  const identity = await getWebIdentity(request, env).catch(() => null);
  if (!identity) return authError(401, "web_session_required");
  const db = createDatabase(env.DB);
  const query = db.select({ teamId: teams.id, team: teams.slug })
    .from(teamMemberships)
    .innerJoin(teams, eq(teamMemberships.teamId, teams.id))
    .where(eq(teamMemberships.userId, identity.id));
  const memberships = await query;
  const selected = expectedTeamId
    ? memberships.find((membership) => membership.teamId === expectedTeamId)
    : requestedTeam
      ? memberships.find((membership) => membership.team === requestedTeam)
      : memberships.length === 1 ? memberships[0] : undefined;
  if (!selected) return authError(requestedTeam || expectedTeamId ? 403 : 400, requestedTeam || expectedTeamId ? "team_access_required" : "team_selection_required");
  return selected;
}

function safeRelativePath(value: string | null): string | null {
  if (value === null || value.length === 0 || value.length > MAX_PATH_LENGTH || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    return null;
  }
  const normalized = value.normalize("NFC");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return normalized;
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "\0";
  }
}

function contentTypeForPath(path: string): string {
  const extension = path.split("/").at(-1)?.split(".").at(-1)?.toLowerCase();
  switch (extension) {
    case "json": return "application/json; charset=utf-8";
    case "txt": return "text/plain; charset=utf-8";
    case "md": return "text/markdown; charset=utf-8";
    case "html": case "htm": return "text/html; charset=utf-8";
    case "csv": return "text/csv; charset=utf-8";
    case "css": return "text/css; charset=utf-8";
    case "svg": return "image/svg+xml";
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    case "xml": return "application/xml";
    default: return "application/octet-stream";
  }
}
