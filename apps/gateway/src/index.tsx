import { Hono } from "hono";
import { createWebAuth } from "./auth/better-auth.ts";
import {
  handleApiTokens,
  handleAuthMe,
  handleDeviceApprove,
  handleDevicePoll,
  handleDeviceStart,
  handleRefresh,
  handleRevokeApiToken,
  handleTeams,
} from "./auth/routes.ts";
import { authError, noStoreHeaders, withNoStore } from "./auth/middleware.ts";
import { handleTeam, handleTeamApiTokens, handleTeamDevices } from "./auth/team-routes.ts";
import type { GatewayEnv } from "./auth/types.ts";
import { getWebIdentity } from "./auth/web-session.ts";
import { createEmbedToken, listArtifactFiles, listArtifacts, serveArtifact, uploadArtifact } from "./content/routes.ts";
import { AuthPage } from "./web/auth-page.tsx";
import { authScript, authStyles } from "./web/auth-assets.ts";
import { registerDashboardRoutes } from "./web/dashboard-routes.tsx";
import { assetHeaders, pageSecurityHeaders, safeLocalPath } from "./web/http.ts";

const DEFAULT_AUTH_RETURN = "/dashboard";
const reservedFirstSegments = new Set(["__api", "auth", "dashboard", "settings", "favicon.ico", "robots.txt"]);
const app = new Hono<{ Bindings: GatewayEnv }>();

app.all("/__api/auth", (c) => createWebAuth(c.env).handler(c.req.raw).then(withNoStore));
app.all("/__api/auth/*", (c) => createWebAuth(c.env).handler(c.req.raw).then(withNoStore));

app.get("/assets/auth.css", (c) => c.body(authStyles, 200, assetHeaders("text/css; charset=utf-8")));
app.get("/assets/auth.js", (c) => c.body(authScript, 200, assetHeaders("text/javascript; charset=utf-8")));

registerDashboardRoutes(app);

app.get("/auth/login", async (c) => {
  const returnTo = safeLocalPath(c.req.query("returnTo") ?? DEFAULT_AUTH_RETURN, DEFAULT_AUTH_RETURN);
  const identity = await getWebIdentity(c.req.raw, c.env).catch(() => null);
  if (identity) return c.redirect(returnTo, 302);
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.html(<AuthPage returnTo={returnTo} />, 200, pageSecurityHeaders);
});

app.get("/__api/v1/auth/me", (c) => handleAuthMe(c.req.raw, c.env));
app.post("/__api/v1/auth/refresh", (c) => handleRefresh(c.req.raw, c.env));
app.get("/__api/v1/teams", (c) => handleTeams(c.req.raw, c.env));
app.get("/__api/v1/teams/:teamId", (c) => handleTeam(c.req.raw, c.env, c.req.param("teamId")));
app.patch("/__api/v1/teams/:teamId", (c) => handleTeam(c.req.raw, c.env, c.req.param("teamId")));
app.get("/__api/v1/teams/:teamId/api-tokens", (c) => handleTeamApiTokens(c.req.raw, c.env, c.req.param("teamId")));
app.get("/__api/v1/teams/:teamId/devices", (c) => handleTeamDevices(c.req.raw, c.env, c.req.param("teamId")));
app.get("/__api/v1/api-tokens", (c) => handleApiTokens(c.req.raw, c.env));
app.post("/__api/v1/api-tokens", (c) => handleApiTokens(c.req.raw, c.env));
app.delete("/__api/v1/api-tokens/:tokenId", (c) => handleRevokeApiToken(c.req.raw, c.env, c.req.param("tokenId")));
app.post("/__api/v1/device/start", (c) => handleDeviceStart(c.req.raw, c.env));
app.post("/__api/v1/device/poll", (c) => handleDevicePoll(c.req.raw, c.env));
app.post("/__api/v1/device/approve", (c) => handleDeviceApprove(c.req.raw, c.env));
app.put("/__api/v1/uploads", (c) => uploadArtifact(c.req.raw, c.env));
app.get("/__api/v1/artifacts", (c) => listArtifacts(c.req.raw, c.env));
app.get("/__api/v1/artifacts/:artifactSlug/files", (c) => listArtifactFiles(c.req.raw, c.env, c.req.param("artifactSlug")));
app.post("/__api/v1/artifacts/embed-token", (c) => createEmbedToken(c.req.raw, c.env));

app.get("*", async (c) => {
  const url = new URL(c.req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && !reservedFirstSegments.has(segments[0])) {
    return serveArtifact(c.req.raw, c.env, segments[0]);
  }
  if (url.pathname === "/") {
    const identity = await getWebIdentity(c.req.raw, c.env).catch(() => null);
    return identity ? c.redirect("/dashboard", 302) : loginRedirect("/dashboard", url.toString());
  }
  return c.text("Not found", 404, Object.fromEntries(noStoreHeaders()));
});

app.notFound((c) => c.text("Not found", 404, Object.fromEntries(noStoreHeaders())));

app.onError((error) => {
  console.error("gateway request failed", error);
  return authError(503, "gateway_service_unavailable");
});

function loginRedirect(path: string, requestUrl: string): Response {
  const returnTo = `${path}${new URL(requestUrl).search}`;
  return new Response(null, {
    status: 302,
    headers: noStoreHeaders({ Location: `/auth/login?returnTo=${encodeURIComponent(returnTo)}` }),
  });
}

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
