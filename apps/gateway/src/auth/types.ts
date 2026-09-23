export const PUBLISH_PERMISSION = "artifacts:publish";
export const READ_PERMISSION = "artifacts:read";
export const ACCESS_TOKEN_SECONDS = 7 * 24 * 60 * 60;
export const REFRESH_IDLE_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_MAX_SECONDS = 90 * 24 * 60 * 60;

export interface PublisherIdentity {
  userId: string;
  email: string;
  name: string;
  teamId: string;
  team: string;
  permissions: string[];
  expiresAt: string;
  tokenId: string;
}

export interface AuthContext {
  identity: PublisherIdentity;
}

export type GatewayEnv = Env;
