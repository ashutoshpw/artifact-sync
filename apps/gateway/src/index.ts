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
import type { GatewayEnv } from "./auth/types.ts";
import { listArtifacts, serveArtifact, uploadArtifact } from "./content/routes.ts";
import { apiTokensPage, authLoginPage, devicePage } from "./web/pages.ts";
import { noStoreHeaders } from "./auth/middleware.ts";
import { getWebIdentity } from "./auth/web-session.ts";

const reservedFirstSegments = new Set(["__api", "auth", "settings", "favicon.ico", "robots.txt"]);

const worker = {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/__api/auth" || path.startsWith("/__api/auth/")) {
      return handleWebAuth(request, env);
    }
    if (path === "/auth/login" && request.method === "GET") {
      return authLoginPage(url.searchParams.get("returnTo") ?? "/settings/api-tokens");
    }
    if (path === "/settings/api-tokens" && request.method === "GET") {
      const identity = await getWebIdentity(request, env).catch(() => null);
      if (!identity) return loginRedirect(path + url.search);
      return apiTokensPage();
    }
    if (path === "/auth/device" && request.method === "GET") {
      const identity = await getWebIdentity(request, env).catch(() => null);
      if (!identity) return loginRedirect(path + url.search);
      return devicePage();
    }

    if (path === "/__api/v1/auth/me" && request.method === "GET") return handleAuthMe(request, env);
    if (path === "/__api/v1/auth/refresh" && request.method === "POST") return handleRefresh(request, env);
    if (path === "/__api/v1/teams" && request.method === "GET") return handleTeams(request, env);
    if (path === "/__api/v1/api-tokens") return handleApiTokens(request, env);
    const revokeMatch = path.match(/^\/__api\/v1\/api-tokens\/([^/]+)$/);
    if (revokeMatch && request.method === "DELETE") return handleRevokeApiToken(request, env, revokeMatch[1]);
    if (path === "/__api/v1/device/start" && request.method === "POST") return handleDeviceStart(request, env);
    if (path === "/__api/v1/device/poll" && request.method === "POST") return handleDevicePoll(request, env);
    if (path === "/__api/v1/device/approve" && request.method === "POST") return handleDeviceApprove(request, env);
    if (path === "/__api/v1/uploads" && request.method === "PUT") return uploadArtifact(request, env);
    if (path === "/__api/v1/artifacts" && request.method === "GET") return listArtifacts(request, env);

    if (request.method === "GET") {
      const segments = path.split("/").filter(Boolean);
      if (segments.length >= 2 && !reservedFirstSegments.has(segments[0])) {
        return serveArtifact(request, env, segments[0]);
      }
      if (path === "/") return loginRedirect("/settings/api-tokens");
    }
    return new Response("Not found", { status: 404, headers: noStoreHeaders() });
  },
} satisfies ExportedHandler<Env>;

async function handleWebAuth(request: Request, env: GatewayEnv): Promise<Response> {
  const response = await createWebAuth(env).handler(request);
  const headers = noStoreHeaders(response.headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function loginRedirect(returnTo: string): Response {
  return new Response(null, {
    status: 302,
    headers: noStoreHeaders({ Location: `/auth/login?returnTo=${encodeURIComponent(returnTo)}` }),
  });
}

export default worker;
