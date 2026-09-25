const CSRF_CONTEXT = "artifact-sync-dashboard-csrf-v1";
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const encoder = new TextEncoder();

export async function issueDashboardCsrfToken(secret: string, sessionToken: string): Promise<string> {
  const secretBytes = encoder.encode(secret);
  if (secretBytes.byteLength < 32) throw new Error("dashboard csrf secret is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secretBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(encoder.encode(`${CSRF_CONTEXT}:${sessionToken}`)),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export function matchesDashboardCsrfToken(candidate: FormDataEntryValue | null, expected: string): boolean {
  if (typeof candidate !== "string" || !CSRF_TOKEN_PATTERN.test(candidate) || !CSRF_TOKEN_PATTERN.test(expected)) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function isDashboardMutationAllowed(request: Request, form: FormData, csrfToken: string): boolean {
  const origin = request.headers.get("Origin");
  if (!origin || origin === new URL(request.url).origin) return true;
  return origin === "null" && matchesDashboardCsrfToken(form.get("csrfToken"), csrfToken);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
