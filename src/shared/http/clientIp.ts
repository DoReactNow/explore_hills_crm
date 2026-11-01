// The caller's address, for limits and the sign-in record.
import { isIP } from "node:net";

export const UNKNOWN_IP = "unknown";

/**
 * Counted from the right of X-Forwarded-For (Decision 49): each proxy appends the address it saw,
 * so entries further left can be faked by the caller. No readable address means the shared
 * "unknown" bucket, which is limited like any other.
 */
export function clientIp(headers: Headers, trustedProxyHops: number): string {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = entries[entries.length - 1 - trustedProxyHops];
  return candidate && isIP(candidate) ? candidate : UNKNOWN_IP;
}
