// W-110: the daily clean-up removes only what is past its cut-off.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPrisma } from "@/shared/db/prisma";
import { startTestJobRuntime, type TestJobRuntime } from "@/shared/jobs/testing/testRuntime";
import { createTestClock, parseInstant } from "@/shared/time";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { syncRbac } from "..";
import { createCleanupService } from "../identity.cleanup";
import { cleanupSessionsJob, identityJobs, identitySchedules } from "../identity.jobs";

const prisma = getPrisma();
const NOW = "2026-10-30T10:00:00.000Z";
let userId: string;
let runtime: TestJobRuntime;

const addSession = async (expiresAt: string, revokedAt?: string) => {
  const session = await prisma.identitySession.create({
    data: {
      userId,
      tokenHash: randomUUID(),
      expiresAt: parseInstant(expiresAt),
      lastSeenAt: parseInstant("2020-01-01T00:00:00.000Z"),
      revokedAt: revokedAt ? parseInstant(revokedAt) : null,
    },
  });
  return session.id;
};
const addThrottle = (key: string, windowStart: string) =>
  prisma.identityLoginThrottle.create({
    data: { key, windowStart: parseInstant(windowStart), count: 1 },
  });
const remainingSessions = async () =>
  (await prisma.identitySession.findMany({ select: { id: true } })).map((row) => row.id).sort();
const remainingKeys = async () =>
  (await prisma.identityLoginThrottle.findMany({ select: { key: true } }))
    .map((row) => row.key)
    .sort();

beforeAll(async () => {
  runtime = await startTestJobRuntime({ start: NOW });
});
beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
  const user = await prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Tara Singh",
      passwordHash: "hash",
      status: "ACTIVE",
      roleId: role.id,
    },
  });
  userId = user.id;
});
afterAll(async () => {
  await runtime.stop();
  await resetDatabase();
  await prisma.$disconnect();
});

describe("the clean-up rules", () => {
  const cleanup = createCleanupService(undefined, createTestClock(NOW));

  it("deletes only sessions expired or revoked over 7 days ago (P1-SESSION-14)", async () => {
    const active = await addSession("2026-10-30T20:00:00.000Z");
    const recentlyExpired = await addSession("2026-10-23T10:00:00.000Z");
    const recentlyRevoked = await addSession(
      "2026-11-01T00:00:00.000Z",
      "2026-10-23T10:00:00.000Z",
    );
    await addSession("2026-10-23T09:59:59.999Z");
    await addSession("2026-11-01T00:00:00.000Z", "2026-10-23T09:59:59.999Z");

    await cleanup.run();

    expect(await remainingSessions()).toEqual([active, recentlyExpired, recentlyRevoked].sort());
  });

  it("deletes only throttle rows whose window ended over a day ago", async () => {
    await addThrottle("ended-just-under-a-day-ago", "2026-10-29T09:45:00.000Z");
    await addThrottle("ended-over-a-day-ago", "2026-10-29T09:44:59.999Z");
    await addThrottle("running", "2026-10-30T09:59:00.000Z");

    await cleanup.run();

    expect(await remainingKeys()).toEqual(["ended-just-under-a-day-ago", "running"]);
  });

  it("changes nothing more when run twice", async () => {
    const active = await addSession("2026-10-30T20:00:00.000Z");
    await addSession("2020-01-01T00:00:00.000Z");
    await cleanup.run();
    await cleanup.run();
    expect(await remainingSessions()).toEqual([active]);
  });
});

describe("the job on the real queue", () => {
  it("runs through the queue, and twice changes nothing more", async () => {
    const active = await addSession("2099-01-01T00:00:00.000Z");
    await addSession("2020-01-01T00:00:00.000Z");

    await runtime.queue.enqueue(cleanupSessionsJob, {});
    expect(await runtime.runPendingJobs(identityJobs)).toBe(1);
    expect(await remainingSessions()).toEqual([active]);

    await runtime.queue.enqueue(cleanupSessionsJob, {});
    await runtime.runPendingJobs(identityJobs);
    expect(await remainingSessions()).toEqual([active]);
  });

  it("is scheduled for 03:30 in the business timezone", async () => {
    for (const { job, cron, payload } of identitySchedules) {
      await runtime.queue.schedule(job as never, cron, payload as never);
    }
    const schedules = await runtime.boss.getSchedules();
    expect(schedules.find((row) => row.name === "identity.cleanupSessions")).toMatchObject({
      cron: "30 3 * * *",
      timezone: "Asia/Kolkata",
    });
  });
});
