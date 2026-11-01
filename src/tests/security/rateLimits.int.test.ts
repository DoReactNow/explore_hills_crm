// P11-SEC-02: limits on sensitive routes. The scan makes sure no listed route loses its limit, and the
// calls prove a limit really refuses, keeps people apart and comes back when its minute ends.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getPrisma } from "@/shared/db/prisma";
import {
  RATE_LIMITS,
  WINDOW_SECONDS,
  enforceRateLimit,
  sweepRateLimits,
} from "@/shared/http/rateLimit";
import { rateLimitRepository } from "@/shared/http/rateLimit.repository";
import { route } from "@/shared/http/route";
import type { Principal } from "@/shared/rbac/principal";
import { plusDuration, systemClock } from "@/shared/time";

const prisma = getPrisma();

const LIMITED: ReadonlyArray<[string, string, keyof typeof RATE_LIMITS]> = [
  ["reports/export", "GET", "export"],
  ["audit/export", "GET", "export"],
  ["privacy/contacts/[id]/export", "GET", "export"],
  ["privacy/contacts/[id]/erase", "POST", "privacy"],
  ["privacy/contacts/[id]/hold", "POST", "privacy"],
  ["privacy/contacts/[id]/consent", "POST", "privacy"],
  ["privacy/contacts", "GET", "lookup"],
  ["conversations/[id]/media", "POST", "upload"],
  ["conversations/[id]/messages", "POST", "send"],
  ["conversations/[id]/template", "POST", "send"],
  ["messages/[id]/media", "GET", "file"],
  ["telephony/calls/[id]/recording", "GET", "file"],
  ["leads/[id]/calls", "POST", "call"],
  ["users/[id]/password", "POST", "password"],
  ["users", "POST", "admin"],
  ["users/[id]/deactivate", "POST", "admin"],
  ["users/[id]/reactivate", "POST", "admin"],
  ["roles", "POST", "admin"],
  ["roles/[id]/reset", "POST", "admin"],
  ["notifications/push", "POST", "admin"],
  ["leads", "POST", "write"],
  ["leads/[id]/merge", "POST", "write"],
  ["leads/[id]/reassign", "POST", "write"],
  ["assignment/batches", "POST", "write"],
  ["webhooks/whatsapp", "POST", "webhook"],
  ["webhooks/telephony", "POST", "webhook"],
  ["webhooks/telephony/inbound", "POST", "webhook"],
];

const principal = (userId: string) => ({ userId }) as Principal;
const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { headers });
const small = { name: "probe", perMinute: 2 };

beforeEach(async () => {
  await prisma.systemRateLimit.deleteMany();
});

describe("sensitive routes carry a limit", () => {
  it.each(LIMITED)("%s %s uses the %s limit", (path, method, name) => {
    const source = readFileSync(`src/app/api/${path}/route.ts`, "utf8");
    const block = source.slice(source.indexOf(`export const ${method} = route`));
    const end = block.indexOf("});");
    expect(block.slice(0, end)).toContain(`rateLimit: RATE_LIMITS.${name},`);
  });
});

describe("enforceRateLimit", () => {
  it("allows the limit, then refuses", async () => {
    const who = principal(randomUUID());
    await enforceRateLimit(small, request(), who);
    await enforceRateLimit(small, request(), who);
    await expect(enforceRateLimit(small, request(), who)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("keeps people apart, and limits apart", async () => {
    const who = principal(randomUUID());
    await enforceRateLimit({ name: "probe", perMinute: 1 }, request(), who);
    await expect(
      enforceRateLimit({ name: "probe", perMinute: 1 }, request(), principal(randomUUID())),
    ).resolves.toBeUndefined();
    await expect(
      enforceRateLimit({ name: "other", perMinute: 1 }, request(), who),
    ).resolves.toBeUndefined();
  });

  it("counts by address when nobody is signed in", async () => {
    const one = { "x-forwarded-for": "203.0.113.7" };
    await enforceRateLimit({ name: "probe", perMinute: 1 }, request(one), null);
    await expect(
      enforceRateLimit({ name: "probe", perMinute: 1 }, request(one), null),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      enforceRateLimit(
        { name: "probe", perMinute: 1 },
        request({ "x-forwarded-for": "203.0.113.8" }),
        null,
      ),
    ).resolves.toBeUndefined();
  });

  it("counts every hit when many arrive at once", async () => {
    const key = `probe:${randomUUID()}`;
    const now = systemClock.now();
    const counts = await Promise.all(
      Array.from({ length: 20 }, () => rateLimitRepository.hit(key, now, WINDOW_SECONDS)),
    );
    expect(Math.max(...counts)).toBe(20);
  });

  it("starts again when the minute has passed", async () => {
    const key = `probe:${randomUUID()}`;
    const now = systemClock.now();
    await rateLimitRepository.hit(key, now, WINDOW_SECONDS);
    await rateLimitRepository.hit(key, now, WINDOW_SECONDS);
    const later = plusDuration(now, { hours: 1 });
    expect(await rateLimitRepository.hit(key, later, WINDOW_SECONDS)).toBe(1);
  });
});

describe("route()", () => {
  it("answers 429 with the friendly message and when to retry", async () => {
    const handler = route({
      access: "public",
      rateLimit: { name: "probe", perMinute: 1 },
      handler: async () => ({ data: { ok: true } }),
    });
    const context = { params: Promise.resolve({}) };
    const headers = { "x-forwarded-for": "203.0.113.9" };
    expect((await handler(request(headers), context)).status).toBe(200);
    const refused = await handler(request(headers), context);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe(String(WINDOW_SECONDS));
    const body = await refused.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toBe("Too many attempts. Please wait a moment and try again.");
  });
});

describe("sweepRateLimits", () => {
  it("removes rows over an hour old and leaves current ones", async () => {
    const now = systemClock.now();
    await rateLimitRepository.hit("old", plusDuration(now, { hours: -2 }), WINDOW_SECONDS);
    await rateLimitRepository.hit("new", now, WINDOW_SECONDS);
    expect(await sweepRateLimits()).toBe(1);
    expect((await prisma.systemRateLimit.findMany()).map((row) => row.key)).toEqual(["new"]);
  });
});
