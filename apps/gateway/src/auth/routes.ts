import { authenticate, authError, hasPermission } from "./middleware.ts";
import { createTemporaryUploadCredentials } from "./temp-credentials.ts";
import { PUBLISH_PERMISSION } from "./types.ts";
import type { GatewayEnv } from "./types.ts";

export async function handleAuthMe(request: Request, env: GatewayEnv): Promise<Response> {
  const context = await authenticate(request, env);
  if (context instanceof Response) return context;
  return Response.json(context.identity, { headers: { "Cache-Control": "no-store" } });
}

export async function handleUploadCredentials(request: Request, env: GatewayEnv): Promise<Response> {
  const context = await authenticate(request, env);
  if (context instanceof Response) return context;
  if (!hasPermission(context, PUBLISH_PERMISSION)) return authError(403, "publisher_permission_required");

  let requestedTeam: unknown;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return Response.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    requestedTeam = (body as Record<string, unknown>).team;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  if (requestedTeam !== context.identity.team) return authError(403, "team_mismatch");
  try {
    const credentials = await createTemporaryUploadCredentials(context.identity, env);
    return Response.json(credentials, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return authError(503, "credential_service_unavailable");
  }
}
