// Small pure pieces of signing in: session tokens and their expiry, the cookie, and the client IP.
import { createHash, randomBytes } from "node:crypto";
import { SESSION_COOKIE } from "@/shared/http/sessionCookie";
import { plusDuration } from "@/shared/time";

export const SESSION_IDLE_HOURS = 12;
export const SESSION_MAX_DAYS = 7;
const COOKIE_MAX_AGE_SECONDS = SESSION_MAX_DAYS * 24 * 60 * 60;

export { UNKNOWN_IP, clientIp } from "@/shared/http/clientIp";

export const newSessionToken = (): string => randomBytes(32).toString("base64url");

export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** 12 hours after activity, but never later than 7 days after sign-in (Decision 46). */
export function sessionExpiry(signedInAt: Date, activityAt: Date): Date {
  const idle = plusDuration(activityAt, { hours: SESSION_IDLE_HOURS });
  const cap = plusDuration(signedInAt, { days: SESSION_MAX_DAYS });
  return idle.getTime() < cap.getTime() ? idle : cap;
}

const cookieFlags = (secure: boolean) =>
  `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

export const buildSessionCookie = (token: string, secure: boolean): string =>
  `${SESSION_COOKIE}=${token}; ${cookieFlags(secure)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}`;

export const clearSessionCookie = (secure: boolean): string =>
  `${SESSION_COOKIE}=; ${cookieFlags(secure)}; Max-Age=0`;
