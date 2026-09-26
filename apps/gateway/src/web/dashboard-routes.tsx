import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HtmlEscapedString } from "hono/utils/html";
import { createWebAuth } from "../auth/better-auth.ts";
import { isDashboardMutationAllowed } from "../auth/csrf.ts";
import { issueEmbedToken } from "../auth/embed.ts";
import { handleApiTokens, handleDeviceApprove, handleRevokeApiToken } from "../auth/routes.ts";
import { noStoreHeaders, withNoStore } from "../auth/middleware.ts";
import { handleTeam } from "../auth/team-routes.ts";
import type { GatewayEnv } from "../auth/types.ts";
import { getWebSession } from "../auth/web-session.ts";
import { ArtifactDetailPage, ArtifactsPage, DeviceApprovalPage, DevicesPage, GeneralSettingsPage, NoTeamsPage, OverviewPage, ProjectsPage, TokensPage } from "./dashboard.tsx";
import { dashboardScript, dashboardStyles } from "./dashboard-assets.ts";
import {
  createDashboardProject,
  dashboardCounts,
  dashboardSettings,
  deleteDashboardProject,
  getDashboardArtifact,
  listDashboardArtifactFiles,
  listDashboardArtifacts,
  listDashboardDevices,
  listDashboardProjects,
  listDashboardTokens,
  reconcileArtifacts,
  requireDashboardSession,
  setArtifactProjects,
  toggleArtifactPin,
  type DashboardSession,
} from "./dashboard-service.ts";
import { assetHeaders, pageSecurityHeaders } from "./http.ts";

type DashboardEnv = { Bindings: GatewayEnv };
type DashboardApp = Hono<DashboardEnv>;
type DashboardContext = Context<DashboardEnv>;

export function registerDashboardRoutes(app: DashboardApp): void {
  app.get("/assets/dashboard.css", (c) => c.body(dashboardStyles, 200, assetHeaders("text/css; charset=utf-8")));
  app.get("/assets/dashboard.js", (c) => c.body(dashboardScript, 200, assetHeaders("text/javascript; charset=utf-8")));

  app.get("/settings/api-tokens", async (c) => {
    const session = await dashboardSession(c);
    if (session instanceof Response) return session;
    return c.redirect(session.team ? `/dashboard/${session.team.id}/settings/api-tokens` : "/dashboard", 302);
  });

  app.get("/dashboard", async (c) => {
    const session = await dashboardSession(c);
    if (session instanceof Response) return session;
    if (!session.team) return dashboardHtml(c, <NoTeamsPage session={session} />);
    return c.redirect(`/dashboard/${session.team.id}`, 302);
  });

  app.get("/dashboard/:teamId", async (c) => {
    const session = await dashboardSession(c, c.req.param("teamId"));
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    const [list, counts] = await Promise.all([
      listDashboardArtifacts(c.env, session.team.id, null, { limit: 8 }),
      dashboardCounts(c.env, session.identity, session.team),
    ]);
    if (list instanceof Response) {
      return dashboardHtml(c, <OverviewPage session={session} artifacts={[]} artifactsTotal={0} counts={counts} storageError={actionMessage("artifact_storage_unavailable")} />);
    }
    scheduleArtifactReconciliation(c, session.team.id, list.missingSlugs);
    return dashboardHtml(c, <OverviewPage session={session} artifacts={list.items} artifactsTotal={list.total} counts={counts} />);
  });

  app.get("/dashboard/:teamId/artifacts", async (c) => {
    const session = await dashboardSession(c, c.req.param("teamId"));
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    const activeProjectId = c.req.query("project") || null;
    const result = await listDashboardArtifacts(c.env, session.team.id, c.req.query("after") ?? null, { projectId: activeProjectId });
    if (result instanceof Response) {
      if (result.status === 404) return c.text("Not found", 404);
      return dashboardHtml(c, <ArtifactsPage session={session} list={{ items: [], total: 0, nextCursor: null, projects: [] }} activeProjectId={activeProjectId} storageError={actionMessage("artifact_storage_unavailable")} />, result.status as ContentfulStatusCode);
    }
    scheduleArtifactReconciliation(c, session.team.id, result.missingSlugs);
    return dashboardHtml(c, <ArtifactsPage session={session} list={result} activeProjectId={activeProjectId} feedback={artifactFeedback(c)} />);
  });

  app.post("/dashboard/:teamId/artifacts/:artifactSlug/pin", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const teamId = c.req.param("teamId");
    const session = await dashboardSession(c, teamId);
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const slug = c.req.param("artifactSlug");
    const pinned = String(form.get("action") ?? "pin") === "pin";
    const pinnedResult = await toggleArtifactPin(c.env, session.team.id, slug, pinned);
    const pinState = `pin=${pinnedResult ? (pinned ? "1" : "0") : "error"}`;
    if (String(form.get("context") ?? "") === "detail") {
      return c.redirect(`/dashboard/${encodeURIComponent(teamId)}/artifacts/${encodeURIComponent(slug)}?${pinState}`, 303);
    }
    const project = typeof form.get("project") === "string" && form.get("project") ? `project=${encodeURIComponent(String(form.get("project")))}` : "";
    const query = [project, pinState].filter(Boolean).join("&");
    return c.redirect(`/dashboard/${encodeURIComponent(teamId)}/artifacts${query ? `?${query}` : ""}`, 303);
  });

  app.post("/dashboard/:teamId/artifacts/:artifactSlug/projects", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const teamId = c.req.param("teamId");
    const session = await dashboardSession(c, teamId);
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const slug = c.req.param("artifactSlug");
    const projectIds = form.getAll("projectIds").filter((value): value is string => typeof value === "string");
    const saved = await setArtifactProjects(c.env, session.team.id, slug, projectIds);
    return c.redirect(`/dashboard/${encodeURIComponent(teamId)}/artifacts/${encodeURIComponent(slug)}?projects=${saved ? "saved" : "error"}`, 303);
  });

  app.get("/dashboard/:teamId/artifacts/:artifactSlug", async (c) => {
    const session = await dashboardSession(c, c.req.param("teamId"));
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    const artifactSlug = c.req.param("artifactSlug");
    const [filesResult, artifactMeta, projects, embed] = await Promise.all([
      listDashboardArtifactFiles(c.env, session.team.id, artifactSlug, c.req.query("cursor") ?? null),
      getDashboardArtifact(c.env, session.team.id, artifactSlug),
      listDashboardProjects(c.env, session.team.id),
      issueEmbedToken(c.env, session.team.id),
    ]);
    if (filesResult instanceof Response) {
      if (filesResult.status === 404) return c.text("Not found", 404);
      return dashboardHtml(c, <ArtifactDetailPage session={session} artifact={artifactSlug} artifactMeta={artifactMeta} projects={projects.map(({ id, name }) => ({ id, name }))} embedToken={embed.token} files={[]} nextCursor={null} storageError={actionMessage("artifact_storage_unavailable")} />, filesResult.status as ContentfulStatusCode);
    }
    if (!c.req.query("cursor") && filesResult.items.length === 0) return c.text("Not found", 404);
    if (!artifactMeta) scheduleArtifactReconciliation(c, session.team.id, [artifactSlug]);
    return dashboardHtml(c, <ArtifactDetailPage session={session} artifact={artifactSlug} artifactMeta={artifactMeta} projects={projects.map(({ id, name }) => ({ id, name }))} embedToken={embed.token} files={filesResult.items} nextCursor={filesResult.nextCursor} feedback={artifactFeedback(c)} />);
  });

  app.get("/dashboard/:teamId/projects", async (c) => {
    const session = await dashboardSession(c, c.req.param("teamId"));
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    const projects = await listDashboardProjects(c.env, session.team.id);
    return dashboardHtml(c, <ProjectsPage session={session} projects={projects} feedback={projectFeedback(c)} />);
  });

  app.post("/dashboard/:teamId/projects", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const teamId = c.req.param("teamId");
    const session = await dashboardSession(c, teamId);
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const result = await createDashboardProject(c.env, teamId, String(form.get("name") ?? ""));
    if (result.ok) return c.redirect(`/dashboard/${encodeURIComponent(teamId)}/projects?created=1`, 303);
    const feedback = result.error === "project_name_taken"
      ? { error: "That project name is already used in this team." }
      : result.error === "invalid_project_name"
        ? { error: "Enter a project name between 1 and 64 characters." }
        : { error: actionMessage("project_service_unavailable") };
    return dashboardHtml(c, <ProjectsPage session={session} projects={await listDashboardProjects(c.env, teamId)} feedback={feedback} />, 422);
  });

  app.post("/dashboard/:teamId/projects/:projectId/delete", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const teamId = c.req.param("teamId");
    const session = await dashboardSession(c, teamId);
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const deleted = await deleteDashboardProject(c.env, teamId, c.req.param("projectId"));
    return c.redirect(`/dashboard/${encodeURIComponent(teamId)}/projects?${deleted ? "deleted=1" : "error=delete"}`, 303);
  });

  app.get("/dashboard/:teamId/settings/general", async (c) => {
    const session = await dashboardSession(c, c.req.param("teamId"));
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    const settings = await dashboardSettings(c.env, session.team);
    return dashboardHtml(c, <GeneralSettingsPage session={session} settings={settings} origin={new URL(c.req.url).origin} feedback={queryFeedback(c)} />);
  });

  app.post("/dashboard/:teamId/settings/general", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const teamId = c.req.param("teamId");
    const session = await dashboardSession(c, teamId);
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const response = await handleTeam(proxyJsonRequest(c.req.raw, `/__api/v1/teams/${encodeURIComponent(teamId)}`, "PATCH", {
      slug: String(form.get("slug") ?? ""),
    }), c.env, teamId);
    if (response.ok) {
      const refreshed = await dashboardSession(c, teamId);
      if (refreshed instanceof Response) return refreshed;
      if (!refreshed.team) return c.text("Not found", 404);
      const settings = await dashboardSettings(c.env, refreshed.team);
      return dashboardHtml(c, <GeneralSettingsPage session={refreshed} settings={settings} origin={new URL(c.req.url).origin} feedback={{ notice: "Team slug updated. Existing artifact URLs now redirect to the new slug." }} />);
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const settings = await dashboardSettings(c.env, session.team);
    return dashboardHtml(c, <GeneralSettingsPage session={session} settings={settings} origin={new URL(c.req.url).origin} feedback={{ error: actionMessage(String(payload.error ?? "invalid_request"), String(payload.nextAvailableAt ?? "")) }} />, response.status as ContentfulStatusCode);
  });

  app.get("/dashboard/:teamId/settings/api-tokens", async (c) => {
    const session = await dashboardSession(c, c.req.param("teamId"));
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    const page = await listDashboardTokens(c.env, session.identity, session.team, c.req.query("cursor") ?? null);
    if (page instanceof Response) return page;
    return dashboardHtml(c, <TokensPage session={session} page={page} feedback={queryFeedback(c)} />);
  });

  app.post("/dashboard/:teamId/settings/api-tokens", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const teamId = c.req.param("teamId");
    const session = await dashboardSession(c, teamId);
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const response = await handleApiTokens(proxyJsonRequest(c.req.raw, "/__api/v1/api-tokens", "POST", {
      name: String(form.get("name") ?? ""),
      teamId,
    }), c.env);
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const page = await listDashboardTokens(c.env, session.identity, session.team, null);
    if (response.status === 201 && page && !(page instanceof Response) && typeof payload.token === "string") {
      return dashboardHtml(c, <TokensPage session={session} page={page} createdToken={{ name: String(payload.name ?? "API token"), token: payload.token }} />);
    }
    if (page instanceof Response) return page;
    return dashboardHtml(c, <TokensPage session={session} page={page} feedback={{ error: actionMessage(String(payload.error ?? "invalid_request")) }} />, response.status as ContentfulStatusCode);
  });

  app.post("/dashboard/:teamId/settings/api-tokens/revoke", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const teamId = c.req.param("teamId");
    const session = await dashboardSession(c, teamId);
    if (session instanceof Response) return session;
    if (!session.team) return c.text("Not found", 404);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const tokenId = String(form.get("tokenId") ?? "");
    const response = await handleRevokeApiToken(proxyRequest(c.req.raw, `/__api/v1/api-tokens/${encodeURIComponent(tokenId)}`, "DELETE"), c.env, tokenId);
    if (response.status === 204) return c.redirect(`/dashboard/${encodeURIComponent(session.team.id)}/settings/api-tokens?revoked=1`, 303);
    return c.redirect(`/dashboard/${encodeURIComponent(session.team.id)}/settings/api-tokens?revokeError=1`, 303);
  });

  app.get("/dashboard/:teamId/settings/devices", async (c) => {
    const session = await dashboardSession(c, c.req.param("teamId"));
    if (session instanceof Response || !session.team) return session instanceof Response ? session : c.text("Not found", 404);
    const scope = c.req.query("scope") === "team" && session.team.role !== "member" ? "team" : "mine";
    const page = await listDashboardDevices(c.env, session.identity, session.team, scope, c.req.query("cursor") ?? null);
    if (page instanceof Response) return page;
    return dashboardHtml(c, <DevicesPage session={session} page={page} scope={scope} feedback={queryFeedback(c)} />);
  });

  app.post("/dashboard/:teamId/settings/devices/revoke", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const teamId = c.req.param("teamId");
    const session = await dashboardSession(c, teamId);
    if (session instanceof Response) return session;
    if (!session.team) return c.text("Not found", 404);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const tokenId = String(form.get("tokenId") ?? "");
    const response = await handleRevokeApiToken(proxyRequest(c.req.raw, `/__api/v1/api-tokens/${encodeURIComponent(tokenId)}`, "DELETE"), c.env, tokenId);
    if (response.status === 204) return c.redirect(`/dashboard/${encodeURIComponent(session.team.id)}/settings/devices?revoked=1`, 303);
    return c.redirect(`/dashboard/${encodeURIComponent(session.team.id)}/settings/devices?revokeError=1`, 303);
  });

  app.get("/auth/device", async (c) => {
    const session = await dashboardSession(c);
    if (session instanceof Response) return session;
    if (!session.teams.length) return c.redirect("/dashboard", 302);
    return dashboardHtml(c, <DeviceApprovalPage session={session} code={safeUserCode(c.req.query("code"))} />);
  });

  app.post("/auth/device", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    const form = await c.req.raw.formData();
    if (isOpaqueOrigin(c.req.raw) && typeof form.get("csrfToken") !== "string") return forbidden(c);
    const session = await dashboardSession(c);
    if (session instanceof Response) return session;
    if (!session.teams.length) return c.redirect("/dashboard", 302);
    if (!isDashboardMutationAllowed(c.req.raw, form, session.csrfToken)) return forbidden(c);
    const userCode = String(form.get("userCode") ?? "").toUpperCase();
    const response = await handleDeviceApprove(proxyJsonRequest(c.req.raw, "/__api/v1/device/approve", "POST", {
      userCode,
      teamId: String(form.get("teamId") ?? ""),
    }), c.env);
    if (response.ok) return dashboardHtml(c, <DeviceApprovalPage session={session} code={userCode} success />);
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return dashboardHtml(c, <DeviceApprovalPage session={session} code={userCode} error={actionMessage(String(payload.error ?? "invalid_request"))} />, response.status as ContentfulStatusCode);
  });

  app.post("/auth/logout", async (c) => {
    if (hasForeignOrigin(c.req.raw)) return forbidden(c);
    if (isOpaqueOrigin(c.req.raw)) {
      const form = await c.req.raw.formData();
      const webSession = await getWebSession(c.req.raw, c.env);
      if (!webSession || !isDashboardMutationAllowed(c.req.raw, form, webSession.csrfToken)) return forbidden(c);
    }
    const authResponse = withNoStore(await createWebAuth(c.env).handler(proxyJsonRequest(
      c.req.raw,
      "/__api/auth/sign-out",
      "POST",
      { disableRedirect: true },
      { Origin: c.env.APP_ORIGIN },
    )));
    if (!authResponse.ok) return c.text("Could not sign out. Reload the page and try again.", authResponse.status as ContentfulStatusCode, Object.fromEntries(noStoreHeaders()));
    const headers = new Headers({ Location: "/auth/login", "Cache-Control": "no-store", Pragma: "no-cache" });
    authResponse.headers.forEach((value, name) => {
      if (name.toLowerCase() !== "set-cookie") headers.set(name, value);
    });
    for (const cookie of authResponse.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  });
}

async function dashboardSession(c: DashboardContext, teamId?: string): Promise<DashboardSession | Response> {
  const result = await requireDashboardSession(c.req.raw, c.env, teamId);
  if (!(result instanceof Response)) return result;
  if (result.status !== 401) return result;
  const returnTo = `${c.req.path}${new URL(c.req.url).search}`;
  return c.redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`, 302);
}

function dashboardHtml(
  c: DashboardContext,
  content: HtmlEscapedString | Promise<HtmlEscapedString>,
  status: ContentfulStatusCode = 200,
): Response | Promise<Response> {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.html(content, status, pageSecurityHeaders);
}

function proxyJsonRequest(request: Request, path: string, method: "POST" | "PATCH", body: unknown, headers: Record<string, string> = {}): Request {
  return proxyRequest(request, path, method, {
    body: JSON.stringify(body),
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function proxyRequest(request: Request, path: string, method: string, options: { body?: string; headers?: Record<string, string> } = {}): Request {
  const headers = new Headers(options.headers);
  const cookie = request.headers.get("Cookie");
  if (cookie) headers.set("Cookie", cookie);
  return new Request(new URL(path, request.url), { method, headers, body: options.body });
}

function forbidden(c: DashboardContext): Response {
  return c.text("Forbidden", 403, Object.fromEntries(noStoreHeaders()));
}

function hasForeignOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin !== "null" && origin !== new URL(request.url).origin);
}

function isOpaqueOrigin(request: Request): boolean {
  return request.headers.get("Origin") === "null";
}

function safeUserCode(value: string | undefined): string {
  const normalized = (value ?? "").toUpperCase();
  return /^[A-HJ-NP-Z2-9]{0,8}$/u.test(normalized) ? normalized : "";
}

function queryFeedback(c: DashboardContext): { error?: string; notice?: string } | undefined {
  if (c.req.query("revoked")) return { notice: "Credential revoked. Future refresh attempts are blocked." };
  if (c.req.query("revokeError")) return { error: "Credential could not be revoked." };
  return undefined;
}

function artifactFeedback(c: DashboardContext): { error?: string; notice?: string } | undefined {
  const pin = c.req.query("pin");
  if (pin === "1") return { notice: "Artifact pinned. It stays at the top of every artifact list." };
  if (pin === "0") return { notice: "Artifact unpinned." };
  if (pin === "error") return { error: "The artifact could not be pinned." };
  if (c.req.query("projects") === "saved") return { notice: "Project membership updated." };
  if (c.req.query("projects") === "error") return { error: "Project membership could not be updated." };
  return undefined;
}

function projectFeedback(c: DashboardContext): { error?: string; notice?: string } | undefined {
  if (c.req.query("created")) return { notice: "Project created. Use Organize on an artifact to add it." };
  if (c.req.query("deleted")) return { notice: "Project deleted. Artifacts remain untouched." };
  if (c.req.query("error") === "delete") return { error: "The project could not be deleted." };
  return undefined;
}

function scheduleArtifactReconciliation(c: DashboardContext, teamId: string, slugs: string[]): void {
  if (!slugs.length) return;
  const work = reconcileArtifacts(c.env, teamId, slugs).catch(() => {});
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (tests, local tooling): let the work settle detached.
  }
}

function actionMessage(code: string, nextAvailableAt = ""): string {
  const messages: Record<string, string> = {
    invalid_request: "The request could not be completed.",
    invalid_team_slug: "Use 1–63 lowercase letters, numbers, or hyphens, with no leading or trailing hyphen.",
    invalid_token_name: "Enter a token name between 1 and 64 characters.",
    invalid_cursor: "This page link is invalid. Return to the first page and try again.",
    invalid_artifact_prefix: "The selected artifact folder is invalid.",
    team_owner_required: "Only a team owner can change this slug.",
    team_slug_taken: "That team URL is already reserved.",
    team_slug_change_cooldown: nextAvailableAt
      ? `This team can change its URL again after ${new Date(nextAvailableAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC.`
      : "This team can change its URL only once every 30 days.",
    artifact_storage_unavailable: "Artifact storage is temporarily unavailable.",
    invalid_device_code: "That device code is invalid or has expired.",
    device_request_not_found_or_expired: "That device request is invalid or has expired.",
    device_request_denied: "That device request was denied.",
    team_access_required: "You do not have access to this team.",
    token_service_unavailable: "Credential service is temporarily unavailable.",
    identity_service_unavailable: "Identity service is temporarily unavailable.",
  };
  return messages[code] ?? "The request could not be completed.";
}
