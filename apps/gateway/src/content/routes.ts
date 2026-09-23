import type { GatewayEnv } from "../auth/types.ts";

const TEAM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function decodePathPart(part: string): string | null {
  try {
    const decoded = decodeURIComponent(part);
    if (!decoded || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function serveArtifact(request: Request, env: GatewayEnv, publicPrefix: string): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(publicPrefix)) return new Response("Not found", { status: 404 });
  const rawParts = pathname.slice(`/${publicPrefix}/`.length).split("/");
  if (rawParts.length < 2) return new Response("Not found", { status: 404 });
  const team = decodePathPart(rawParts[0]);
  const keyParts = rawParts.slice(1).map(decodePathPart);
  if (!team || !TEAM_PATTERN.test(team) || keyParts.some((part) => part === null)) return new Response("Not found", { status: 404 });
  const objectKey = `teams/${team}/artifacts/${(keyParts as string[]).join("/")}`;
  const object = await env.ARTIFACTS_BUCKET.get(objectKey);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
