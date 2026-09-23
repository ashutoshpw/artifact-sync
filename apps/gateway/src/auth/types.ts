export const PUBLISH_PERMISSION = "artifacts:publish";

export interface PublisherTokenRecord {
  tokenId: string;
  tokenHash: string;
  publisherId: string;
  team: string;
  permissions: string[];
  expiresAt: string;
  revokedAt?: string;
}

export interface PublisherRegistry {
  version: 1;
  tokens: PublisherTokenRecord[];
}

export interface PublisherIdentity {
  publisherId: string;
  team: string;
  permissions: string[];
  expiresAt: string;
  tokenId: string;
}

export type GatewayEnv = Env;

export interface AuthContext {
  identity: PublisherIdentity;
}
