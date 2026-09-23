import { handleAuthMe, handleUploadCredentials } from "./auth/routes.ts";
import type { GatewayEnv } from "./auth/types.ts";
import { serveArtifact } from "./content/routes.ts";

const worker = {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__api/v1/auth/me" && request.method === "GET") return handleAuthMe(request, env);
    if (url.pathname === "/__api/v1/uploads/credentials" && request.method === "POST") return handleUploadCredentials(request, env);
    const artifactPrefix = `/${env.ARTIFACTS_PUBLIC_PREFIX}/`;
    if (url.pathname.startsWith(artifactPrefix) && request.method === "GET") {
      return serveArtifact(request, env, env.ARTIFACTS_PUBLIC_PREFIX);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export default worker;
