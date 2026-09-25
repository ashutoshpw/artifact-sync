import { issueDashboardCsrfToken } from "./csrf.ts";
import { createWebAuth } from "./better-auth.ts";
import type { GatewayEnv } from "./types.ts";

export interface WebIdentity {
  id: string;
  email: string;
  name: string;
}

export interface WebSession {
  identity: WebIdentity;
  csrfToken: string;
}

type VerifiedWebSession = WebIdentity & { sessionToken: string };

export async function getWebSession(request: Request, env: GatewayEnv): Promise<WebSession | null> {
  const session = await getVerifiedWebSession(request, env);
  if (!session) return null;
  return {
    identity: { id: session.id, email: session.email, name: session.name },
    csrfToken: await issueDashboardCsrfToken(env.BETTER_AUTH_SECRET, session.sessionToken),
  };
}

export async function getWebIdentity(request: Request, env: GatewayEnv): Promise<WebIdentity | null> {
  const session = await getVerifiedWebSession(request, env);
  if (!session) return null;
  return {
    id: session.id,
    email: session.email,
    name: session.name,
  };
}

async function getVerifiedWebSession(request: Request, env: GatewayEnv): Promise<VerifiedWebSession | null> {
  const session = await createWebAuth(env).api.getSession({ headers: request.headers });
  if (!session || !session.user.emailVerified || typeof session.session.token !== "string" || !session.session.token) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    sessionToken: session.session.token,
  };
}
