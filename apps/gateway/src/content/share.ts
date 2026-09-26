import { and, eq, isNull, sql } from "drizzle-orm";
import { createDatabase } from "../db/client.ts";
import { artifactShares, artifacts, teams } from "../db/schema.ts";
import type { GatewayEnv } from "../auth/types.ts";

const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface ArtifactShareScope {
  artifactId: string;
  artifactSlug: string;
  teamId: string;
  teamSlug: string;
}

export function createArtifactShareToken(): string {
  const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function isValidArtifactShareToken(token: string): boolean {
  return SHARE_TOKEN_PATTERN.test(token);
}

export async function findActiveArtifactShare(
  env: GatewayEnv,
  token: string,
): Promise<ArtifactShareScope | null> {
  if (!isValidArtifactShareToken(token) || !env.DB || typeof (env.DB as { prepare?: unknown }).prepare !== "function") {
    return null;
  }
  try {
    const db = createDatabase(env.DB);
    const [row] = await db.select({
      artifactId: artifacts.id,
      artifactSlug: sql<string>`${artifacts.slug} AS artifact_slug`,
      teamId: artifacts.teamId,
      teamSlug: sql<string>`${teams.slug} AS team_slug`,
    })
      .from(artifactShares)
      .innerJoin(artifacts, eq(artifactShares.artifactId, artifacts.id))
      .innerJoin(teams, eq(artifacts.teamId, teams.id))
      .where(and(eq(artifactShares.token, token), isNull(artifactShares.revokedAt)))
      .limit(1);
    return row ?? null;
  } catch {
    console.error("artifact share lookup failed");
    return null;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
