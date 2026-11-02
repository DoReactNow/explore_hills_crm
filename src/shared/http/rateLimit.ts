// Limits on sensitive routes (Decision 67), per minute. Sign-in has its own stricter rules (Decision 46).
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";
import type { Principal } from "@/shared/rbac/principal";
import { plusDuration, systemClock } from "@/shared/time";
import { clientIp } from "./clientIp";
import { rateLimitRepository } from "./rateLimit.repository";

export const WINDOW_SECONDS = 60;

export interface RateLimit {
  name: string;
  perMinute: number;
}

const limit = (name: string, perMinute: number): RateLimit => ({ name, perMinute });

export const RATE_LIMITS = {
  /** Whole-table downloads. */
  export: limit("export", 10),
  password: limit("password", 10),
  upload: limit("upload", 20),
  call: limit("call", 30),
  privacy: limit("privacy", 30),
  /** Looking customers up by number or name, so nobody can walk the list. */
  lookup: limit("lookup", 60),
  admin: limit("admin", 60),
  send: limit("send", 60),
  write: limit("write", 120),
  /** Audio players ask for many ranges of one file. */
  file: limit("file", 240),
  /** Per address: a provider sends bursts, and a refused one retries. */
  webhook: limit("webhook", 1200),
} as const;

export async function enforceRateLimit(
  { name, perMinute }: RateLimit,
  request: Request,
  principal: Principal | null,
): Promise<void> {
  const caller = principal?.userId ?? clientIp(request.headers, getEnv().TRUSTED_PROXY_HOPS);
  const key = `${name}:${caller}`;
  const count = await rateLimitRepository.hit(key, systemClock.now(), WINDOW_SECONDS);
  if (count > perMinute)
    throw new AppError("RATE_LIMITED", { logContext: { limit: name, caller } });
}

export async function sweepRateLimits(): Promise<number> {
  return rateLimitRepository.deleteBefore(plusDuration(systemClock.now(), { hours: -1 }));
}
