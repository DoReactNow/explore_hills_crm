// P11-OBS-01: failed and stuck jobs, a stopped worker, a full disk and an error spike each raise one
// alert, to the right people, by a way that works with the worker stopped, and clear when it's over.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { getPrisma } from "@/shared/db/prisma";
import { createLogger, setErrorListener } from "@/shared/logger";
import { plusDuration, createTestClock } from "@/shared/time";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { createMonitoringService, errorFingerprint } from "../monitoring.service";
import { ERROR_SPIKE_PER_HOUR, WORKER_ALERT_AFTER_SECONDS } from "../monitoring.types";

const prisma = getPrisma();
const NOW = "2026-11-06T09:30:00.000Z";
const GIB = 1024 * 1024 * 1024;
const roomy = async () => ({ freeBytes: 500 * GIB, totalBytes: 1000 * GIB });

let clock: ReturnType<typeof createTestClock>;
let service: ReturnType<typeof createMonitoringService>;
let admin: string;
let agent: string;

async function makeUser(code: string) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code } });
  const user = await prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: code,
      passwordHash: "h",
      roleId: role.id,
      status: "ACTIVE",
    },
  });
  return user.id;
}
const beat = (at: Date) =>
  prisma.systemWorkerHeartbeat.upsert({
    where: { workerId: "w" },
    update: { lastBeatAt: at },
    create: { workerId: "w", version: "1", startedAt: at, lastBeatAt: at },
  });
const open = (code: string) =>
  prisma.monitoringAlert.findMany({ where: { code, resolvedAt: null } });
const notes = (userId: string) => prisma.notificationsNotification.findMany({ where: { userId } });

async function job(state: string, fields: Record<string, Date | number> = {}) {
  const name = "monitoring.probe";
  await prisma.$executeRawUnsafe(
    `INSERT INTO pgboss.queue (name, policy, partition, retry_limit, retry_delay, retry_backoff, expire_seconds, retention_seconds, deletion_seconds, table_name)
     SELECT $1, 'standard', false, 0, 0, false, 900, 1209600, 604800, 'job_common'
     WHERE NOT EXISTS (SELECT 1 FROM pgboss.queue WHERE name = $1)`,
    name,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO pgboss.job (id, name, state, start_after, started_on, completed_on)
     VALUES (gen_random_uuid(), $1, $2::pgboss.job_state, $3, $4, $5)`,
    name,
    state,
    fields.start_after ?? clock.now(),
    fields.started_on ?? null,
    fields.completed_on ?? null,
  );
}

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await prisma.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = 'monitoring.probe'`);
  clock = createTestClock(NOW);
  service = createMonitoringService({ clock, disk: roomy });
  admin = await makeUser("ADMIN");
  agent = await makeUser("AGENT");
  await beat(clock.now());
});

describe("a stopped worker", () => {
  it("stays quiet through a normal restart", async () => {
    clock.advance({ seconds: WORKER_ALERT_AFTER_SECONDS - 1 });
    await service.runChecks();
    expect(await open("worker_down")).toHaveLength(0);
  });

  it("raises one alert, and clears when it comes back", async () => {
    clock.advance({ seconds: WORKER_ALERT_AFTER_SECONDS + 1 });
    await service.runChecks();
    await service.runChecks();
    expect(await open("worker_down")).toHaveLength(1);
    expect(await notes(admin)).toHaveLength(1);

    await beat(clock.now());
    await service.runChecks();
    expect(await open("worker_down")).toHaveLength(0);
    expect(await prisma.monitoringAlert.count({ where: { code: "worker_down" } })).toBe(1);
  });

  it("counts a worker that never started", async () => {
    await prisma.systemWorkerHeartbeat.deleteMany();
    await service.runChecks();
    expect(await open("worker_down")).toHaveLength(1);
  });

  it("tells diagnostics holders and nobody else", async () => {
    clock.advance({ seconds: WORKER_ALERT_AFTER_SECONDS + 1 });
    await service.runChecks();
    const [note] = await notes(admin);
    expect(note.kind).toBe("system_alert");
    expect(note.link).toBe("/diagnostics");
    expect(note.body).toContain("background worker has stopped");
    expect(await notes(agent)).toHaveLength(0);
  });

  it("tells a Super Admin too", async () => {
    const owner = await makeUser("SUPER_ADMIN");
    clock.advance({ seconds: WORKER_ALERT_AFTER_SECONDS + 1 });
    await service.runChecks();
    expect(await notes(owner)).toHaveLength(1);
  });

  it("emails without needing a job, since jobs may be what's broken", async () => {
    clock.advance({ seconds: WORKER_ALERT_AFTER_SECONDS + 1 });
    await service.runChecks();
    const queued = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) FROM pgboss.job WHERE name = 'notifications.sendEmail'`,
    );
    expect(Number(queued[0].count)).toBe(0);
  });

  it("two instances noticing at once raise it once", async () => {
    clock.advance({ seconds: WORKER_ALERT_AFTER_SECONDS + 1 });
    const other = createMonitoringService({ clock, disk: roomy });
    await Promise.all([service.runChecks(), other.runChecks()]);
    expect(await prisma.monitoringAlert.count({ where: { code: "worker_down" } })).toBe(1);
    expect(await notes(admin)).toHaveLength(1);
  });
});

describe("the job queue", () => {
  it("alerts on a job that failed for good, naming its queue", async () => {
    await job("failed", { completed_on: clock.now() });
    await service.runChecks();
    const [alert] = await open("jobs_failed");
    expect(alert.detail).toBe("monitoring.probe (1)");
  });

  it("forgets a failure after the look-back", async () => {
    await job("failed", { completed_on: plusDuration(clock.now(), { hours: -2 }) });
    await service.runChecks();
    expect(await open("jobs_failed")).toHaveLength(0);
  });

  it("alerts on a job running past its limit", async () => {
    await job("active", { started_on: plusDuration(clock.now(), { hours: -1 }) });
    await service.runChecks();
    expect(await open("jobs_stuck")).toHaveLength(1);
  });

  it("gives a job its limit plus some grace before calling it stuck", async () => {
    await job("active", { started_on: plusDuration(clock.now(), { hours: -0.3 }) });
    await service.runChecks();
    expect(await open("jobs_stuck")).toHaveLength(0);
  });

  it("keeps an open alert's detail up to date without telling anyone again", async () => {
    await job("failed", { completed_on: clock.now() });
    await service.runChecks();
    await job("failed", { completed_on: clock.now() });
    await service.runChecks();
    const [alert] = await open("jobs_failed");
    expect(alert.detail).toBe("monitoring.probe (2)");
    expect(await notes(admin)).toHaveLength(1);
  });

  it("tells people about each different problem, never folding them together", async () => {
    await job("failed", { completed_on: clock.now() });
    await job("active", { started_on: plusDuration(clock.now(), { hours: -1 }) });
    await service.runChecks();
    const bodies = (await notes(admin)).map((note) => note.body);
    expect(bodies).toHaveLength(2);
    expect(bodies.join(" ")).toContain("failed");
    expect(bodies.join(" ")).toContain("stuck");
  });

  it("leaves a job alone that is still within its limit", async () => {
    await job("active", { started_on: clock.now() });
    await service.runChecks();
    expect(await open("jobs_stuck")).toHaveLength(0);
  });

  it("alerts on a job left waiting long past when it was due", async () => {
    await job("created", { start_after: plusDuration(clock.now(), { hours: -2 }) });
    await service.runChecks();
    expect(await open("jobs_stuck")).toHaveLength(1);
  });

  it("leaves a job alone that is due later", async () => {
    await job("created", { start_after: plusDuration(clock.now(), { hours: 3 }) });
    await service.runChecks();
    expect(await open("jobs_stuck")).toHaveLength(0);
  });
});

describe("the disk", () => {
  const withDisk = (freeBytes: number, totalBytes: number) =>
    createMonitoringService({ clock, disk: async () => ({ freeBytes, totalBytes }) });

  it("alerts under 2 GB free, even on a small disk", async () => {
    await withDisk(1.5 * GIB, 10 * GIB).runChecks();
    const [alert] = await open("disk_low");
    expect(alert.detail).toBe("1.5 GB free of 10.0 GB.");
  });

  it("alerts under 10% free, even on a large disk", async () => {
    await withDisk(50 * GIB, 1000 * GIB).runChecks();
    expect(await open("disk_low")).toHaveLength(1);
  });

  it("clears once there is room again", async () => {
    await withDisk(1 * GIB, 100 * GIB).runChecks();
    await withDisk(50 * GIB, 100 * GIB).runChecks();
    expect(await open("disk_low")).toHaveLength(0);
  });

  it("a check that can't read the disk doesn't stop the others", async () => {
    clock.advance({ seconds: WORKER_ALERT_AFTER_SECONDS + 1 });
    await createMonitoringService({
      clock,
      disk: async () => {
        throw new Error("no disk");
      },
    }).runChecks();
    expect(await open("worker_down")).toHaveLength(1);
  });
});

describe("off-server backups", () => {
  const withStamp = (stamp: Date | "off" | null) =>
    createMonitoringService({
      clock,
      disk: roomy,
      backupStamp: async () => stamp,
      certificateEnd: async () => null,
    });

  it("stays silent until backups are switched on", async () => {
    await withStamp("off").runChecks();
    expect(await open("backup_stale")).toHaveLength(0);
  });

  it("alerts when none has ever finished", async () => {
    await withStamp(null).runChecks();
    expect((await open("backup_stale"))[0].detail).toBe("None has finished yet.");
  });

  it("allows a missed hour or two, then alerts, then clears", async () => {
    await withStamp(plusDuration(clock.now(), { hours: -35 })).runChecks();
    expect(await open("backup_stale")).toHaveLength(0);
    await withStamp(plusDuration(clock.now(), { hours: -37 })).runChecks();
    expect(await open("backup_stale")).toHaveLength(1);
    await withStamp(clock.now()).runChecks();
    expect(await open("backup_stale")).toHaveLength(0);
  });
});

describe("the HTTPS certificate", () => {
  const withEnd = (end: Date | null) =>
    createMonitoringService({
      clock,
      disk: roomy,
      backupStamp: async () => "off",
      certificateEnd: async () => end,
    });

  it("alerts inside 14 days, and clears after renewal", async () => {
    await withEnd(plusDuration(clock.now(), { days: 15 })).runChecks();
    expect(await open("certificate_expiring")).toHaveLength(0);
    await withEnd(plusDuration(clock.now(), { days: 13 })).runChecks();
    expect((await open("certificate_expiring"))[0].detail).toContain("13 days left");
    await withEnd(plusDuration(clock.now(), { days: 90 })).runChecks();
    expect(await open("certificate_expiring")).toHaveLength(0);
  });

  it("ignores an address with no certificate", async () => {
    await withEnd(null).runChecks();
    expect(await open("certificate_expiring")).toHaveLength(0);
  });
});

describe("error tracking", () => {
  const record = (msg: string, message: string, requestId?: string) => ({
    time: NOW,
    level: "error" as const,
    msg,
    err: { name: "TypeError", message },
    requestId,
  });

  it("groups the same fault, whatever IDs and numbers it mentions", () => {
    expect(errorFingerprint("failed", "TypeError", `lead ${randomUUID()} row 7`)).toBe(
      errorFingerprint("failed", "TypeError", `lead ${randomUUID()} row 9`),
    );
    expect(errorFingerprint("failed", "TypeError", "a")).not.toBe(
      errorFingerprint("failed", "RangeError", "a"),
    );
  });

  it("counts one group, keeping the latest request", async () => {
    await service.recordError(record("failed", "row 1", "r1"), "app");
    await service.recordError(record("failed", "row 2", "r2"), "app");
    const { errors } = await service.view();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ count: 2, source: "app", lastRequestId: "r2" });
  });

  it("gets what the logger already masked, not the raw values", async () => {
    let tracked: Promise<void> = Promise.resolve();
    setErrorListener((logged) => {
      tracked = service.recordError(logged, "app");
    });
    const logger = createLogger({ level: "error", sink: () => undefined });
    logger.error("failed", { err: new Error("could not reach +919812345678 at a@example.com") });
    setErrorListener(null);
    await tracked;
    const row = await prisma.monitoringError.findFirstOrThrow();
    expect(row.message).not.toContain("9812345678");
    expect(row.message).not.toContain("a@example.com");
  });

  it("alerts on a spike", async () => {
    for (let i = 0; i < ERROR_SPIKE_PER_HOUR; i += 1) {
      await service.recordError(record("failed", "x"), "app");
    }
    await service.runChecks();
    expect(await open("errors_spike")).toHaveLength(1);
  });

  it("stays quiet below it, and doesn't count alerts as errors", async () => {
    await service.recordError(
      { time: NOW, level: "error", msg: "ALERT: x", alertCode: "disk_low" },
      "app",
    );
    await service.recordError(record("failed", "x"), "app");
    await service.runChecks();
    expect(await open("errors_spike")).toHaveLength(0);
    expect((await service.view()).errors).toHaveLength(1);
  });
});

describe("the screen and clear-out", () => {
  it("reports queues and capacity", async () => {
    await job("created");
    const view = await service.view();
    expect(view.queues).toContainEqual({
      name: "monitoring.probe",
      waiting: 1,
      active: 0,
      failed: 0,
    });
    expect(view.capacity.maxConnections).toBeGreaterThan(0);
    expect(view.capacity.connections).toBeGreaterThan(0);
    expect(view.capacity.databaseBytes).toBeGreaterThan(0);
    expect(view.capacity.diskFreeBytes).toBe(500 * GIB);
  });

  it("clears old errors and old resolved alerts, and never an open one", async () => {
    await service.recordError(
      { time: NOW, level: "error", msg: "old", err: { name: "E", message: "m" } },
      "app",
    );
    clock.advance({ seconds: WORKER_ALERT_AFTER_SECONDS + 1 });
    await service.runChecks();
    clock.advance({ days: 100 });
    await service.sweep();
    expect(await prisma.monitoringError.count()).toBe(0);
    expect(await open("worker_down")).toHaveLength(1);
  });
});
