// The session cookie's name and how to read it. Shared because route() checks for it on writes
// (cross-site protection, Decision 46) without knowing anything about sessions.
export const SESSION_COOKIE = "eh_session";

export function readSessionToken(headers: Headers): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
}
