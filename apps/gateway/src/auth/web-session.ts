import { createWebAuth } from "./better-auth.ts";
import type { GatewayEnv } from "./types.ts";

export interface WebIdentity {
  id: string;
  email: string;
  name: string;
}

export async function getWebIdentity(request: Request, env: GatewayEnv): Promise<WebIdentity | null> {
  const session = await createWebAuth(env).api.getSession({ headers: request.headers });
  if (!session || !session.user.emailVerified) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}
