import { JwtConfigurationError, verifyAccessToken } from "./jwt.ts";
import type { AuthContext, GatewayEnv } from "./types.ts";

export function authError(status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503, error: string): Response {
  return Response.json({ error }, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

export function noStoreHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  result.set("Pragma", "no-cache");
  return result;
}

export function withNoStore(response: Response): Response {
  try {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Pragma", "no-cache");
    return response;
  } catch {
    const headers = new Headers();
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() !== "set-cookie") headers.append(name, value);
    });
    for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    headers.set("Cache-Control", "no-store");
    headers.set("Pragma", "no-cache");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export async function authenticate(request: Request, env: GatewayEnv): Promise<AuthContext | Response> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
  if (!match) return authError(401, "invalid_or_missing_credentials");

  try {
    const identity = await verifyAccessToken(env, match[1]);
    if (!identity) return authError(401, "invalid_or_expired_credentials");
    return { identity };
  } catch (error) {
    if (error instanceof JwtConfigurationError) return authError(503, "authentication_service_unavailable");
    return authError(503, "authentication_service_unavailable");
  }
}

export function hasPermission(context: AuthContext, permission: string): boolean {
  return context.identity.permissions.includes(permission);
}
