import { resolvePublisher } from "./registry.ts";
import type { AuthContext, GatewayEnv, PublisherIdentity } from "./types.ts";

export function authError(status: 401 | 403 | 503, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function authenticate(request: Request, env: GatewayEnv): Promise<AuthContext | Response> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) return authError(401, "invalid_or_missing_credentials");

  let identity: PublisherIdentity | null;
  try {
    identity = await resolvePublisher(match[1], env);
  } catch {
    return authError(503, "authentication_service_unavailable");
  }
  if (!identity) return authError(401, "invalid_or_expired_credentials");
  return { identity };
}

export function hasPermission(context: AuthContext, permission: string): boolean {
  return context.identity.permissions.includes(permission);
}
