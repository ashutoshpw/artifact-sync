export const pageSecurityHeaders = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function safeLocalPath(path: string, fallback: string): string {
  const hasUnsafeCharacter = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return character === "\\" || character === "<" || character === ">" || character === '"' || character === "'" || code <= 31 || code === 127;
  });
  if (!path.startsWith("/") || path.startsWith("//") || hasUnsafeCharacter) return fallback;
  return path;
}

export function assetHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
}
