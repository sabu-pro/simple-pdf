/** Next can normalize request.url to its internal hostname; Host is the browser-facing authority. */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // CLI clients may omit Origin; no cookies or credentials are used.
  try {
    const parsed = new URL(origin);
    const target = new URL(request.url);
    const host = request.headers.get("host") || target.host;
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
      target.protocol.slice(0, -1);
    return parsed.host === host && parsed.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}
