import { and, eq } from "drizzle-orm";
import { authenticate, authError, noStoreHeaders } from "../auth/middleware.ts";
import { PUBLISH_PERMISSION, READ_PERMISSION } from "../auth/types.ts";
import type { GatewayEnv, PublisherIdentity } from "../auth/types.ts";
import { getWebIdentity } from "../auth/web-session.ts";
import { createDatabase } from "../db/client.ts";
import { teamMemberships, teams } from "../db/schema.ts";

const TEAM_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_PATH_LENGTH = 1024;

export async function uploadArtifact(request: Request, env: GatewayEnv): Promise<Response> {
  const context = await authenticate(request, env);
  if (context instanceof Response) return context;
  if (!context.identity.permissions.includes(PUBLISH_PERMISSION)) return authError(403, "publish_permission_required");

  const relativePath = safeRelativePath(new URL(request.url).searchParams.get("path"));
  if (!relativePath || !request.body) return authError(400, "invalid_artifact_path_or_body");

  const key = `uploads/${context.identity.teamId}/artifacts/${relativePath}`;
  try {
    await env.ARTIFACTS_BUCKET.put(key, request.body, {
      httpMetadata: { contentType: contentTypeForPath(relativePath) },
    });
    return Response.json({ path: relativePath }, { status: 201, headers: noStoreHeaders() });
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
}

export async function listArtifacts(request: Request, env: GatewayEnv): Promise<Response> {
  const requestedTeam = new URL(request.url).searchParams.get("team");
  const access = await resolveTeamAccess(request, env, requestedTeam, READ_PERMISSION);
  if (access instanceof Response) return access;

  const url = new URL(request.url);
  const relativePrefix = url.searchParams.get("prefix") ?? "";
  if (relativePrefix && !safeRelativePath(relativePrefix, { allowTrailingSlash: true })) {
    return authError(400, "invalid_artifact_prefix");
  }
  const prefix = `uploads/${access.teamId}/artifacts/${relativePrefix}`;
  const requestedLimit = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  try {
    const result = await env.ARTIFACTS_BUCKET.list({ prefix, limit, cursor });
    const objects = result.objects.map((object) => ({
      path: object.key.slice(`uploads/${access.teamId}/artifacts/`.length),
      size: object.size,
      uploadedAt: object.uploaded.toISOString(),
      etag: object.httpEtag,
    }));
    return Response.json({ team: access.team, objects, truncated: result.truncated, cursor: result.truncated ? result.cursor : null }, {
      headers: noStoreHeaders(),
    });
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
}

export async function serveArtifact(request: Request, env: GatewayEnv, teamSlug: string): Promise<Response> {
  if (!TEAM_SLUG.test(teamSlug)) return new Response("Not found", { status: 404 });
  const pathname = new URL(request.url).pathname;
  const rawRelative = pathname.slice(teamSlug.length + 2);
  const relativePath = safeRelativePath(rawRelative.split("/").map(decodePathPart).join("/"));
  if (!relativePath) return new Response("Not found", { status: 404 });

  const access = await resolveTeamAccess(request, env, teamSlug, READ_PERMISSION);
  if (access instanceof Response) return access;
  try {
    const object = await env.ARTIFACTS_BUCKET.get(`uploads/${access.teamId}/artifacts/${relativePath}`);
    if (!object) return new Response("Not found", { status: 404, headers: noStoreHeaders() });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(object.body, { headers });
  } catch {
    return authError(503, "artifact_storage_unavailable");
  }
}

async function resolveTeamAccess(
  request: Request,
  env: GatewayEnv,
  requestedTeam: string | null,
  permission: string,
): Promise<{ teamId: string; team: string } | Response> {
  if (request.headers.has("Authorization")) {
    const context = await authenticate(request, env);
    if (context instanceof Response) return context;
    if (!context.identity.permissions.includes(permission)) return authError(403, "artifact_permission_required");
    if (requestedTeam && requestedTeam !== context.identity.team) return authError(403, "team_access_required");
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
  const selected = requestedTeam
    ? memberships.find((membership) => membership.team === requestedTeam)
    : memberships.length === 1 ? memberships[0] : undefined;
  if (!selected) return authError(requestedTeam ? 403 : 400, requestedTeam ? "team_access_required" : "team_selection_required");
  return selected;
}

function safeRelativePath(value: string | null, options: { allowTrailingSlash?: boolean } = {}): string | null {
  if (value === null || value.length === 0 || value.length > MAX_PATH_LENGTH || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    return null;
  }
  const normalized = value.normalize("NFC");
  const parts = normalized.split("/");
  if (options.allowTrailingSlash && parts.at(-1) === "") parts.pop();
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
