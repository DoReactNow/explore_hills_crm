// Where to go after signing in: only a path on this site, so a crafted link cannot send someone to
// another website (P1-SIGNIN-11).
const PLACEHOLDER_ORIGIN = "http://same-site.invalid";
const HOME = "/";

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return HOME;
  // Browsers treat a backslash like a slash and drop tabs and newlines, so "/\evil.example" escapes.
  if (/[\\\u0000-\u001f]/.test(raw)) return HOME;
  try {
    const url = new URL(raw, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN || url.pathname === "/sign-in") return HOME;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return HOME;
  }
}
