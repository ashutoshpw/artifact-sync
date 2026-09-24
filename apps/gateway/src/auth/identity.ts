import { authError } from "./middleware.ts";
import type { GatewayEnv } from "./types.ts";
import { getWebIdentity } from "./web-session.ts";

export async function requireBrowserIdentity(request: Request, env: GatewayEnv) {
  try {
    const identity = await getWebIdentity(request, env);
    if (!identity) return authError(401, "web_session_required");
    return identity;
  } catch {
    return authError(503, "identity_service_unavailable");
  }
}
