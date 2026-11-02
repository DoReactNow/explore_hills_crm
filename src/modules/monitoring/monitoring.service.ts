// Monitoring (Decision 67): watches the worker, the job queue, the disk and the error rate, and tells
// the people who hold system:view-diagnostics once per problem. The app runs these checks, not the
// worker, so a stuck worker can't silence them. A dead server can't alert anyone: Phase 12 covers that.
import { createHash } from "node:crypto";
import { stat, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:tls";
import { listPeopleWhoCan } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { getWorkerStatus } from "@/modules/system";
import { getEnv } from "@/shared/config/env";
import { readJobHealth } from "@/shared/jobs/jobHealth.repository";
import { logger, type LogRecord } from "@/shared/logger";
import { connectedStreams } from "@/shared/realtime/relay";
import {
  instantFromEpochMs,
  parseCertificateDate,
  parseInstant,
  plusDuration,
  systemClock,
  toIsoInstant,
  type Clock,
} from "@/shared/time";
import { monitoringRepository as repository } from "./monitoring.repository";
import {
  ALERTS,
  ALERT_RETENTION_DAYS,
  BACKUP_STALE_HOURS,
  BACKUP_STAMP_FILE,
  CERTIFICATE_WARNING_DAYS,
  DISK_MIN_FREE_BYTES,
  DISK_MIN_FREE_RATIO,
  ERROR_RETENTION_DAYS,
  ERROR_SPIKE_PER_HOUR,
  FAILED_LOOK_BACK_HOURS,
  STUCK_GRACE_SECONDS,
  WAITING_TOO_LONG_HOURS,
  WORKER_ALERT_AFTER_SECONDS,
  type AlertCode,
  type MonitoringView,
} from "./monitoring.types";

const HOUR_MS = 3_600_000;
const GIB = 1024 * 1024 * 1024;
const SCREEN_DAYS = 7;

export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
}

async function readDisk(): Promise<DiskSpace> {
  const stats = await statfs(getEnv().STORAGE_LOCAL_DIR ?? tmpdir());
  return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
}

/** When the last off-server backup finished, or null if none has, or null checks are off. */
async function readBackupStamp(): Promise<Date | "off" | null> {
  const { OFFSITE_BACKUP_EXPECTED, STORAGE_LOCAL_DIR } = getEnv();
  if (OFFSITE_BACKUP_EXPECTED !== "true" || !STORAGE_LOCAL_DIR) return "off";
  return stat(join(STORAGE_LOCAL_DIR, BACKUP_STAMP_FILE)).then(
    (file) => file.mtime,
    () => null,
  );
}

/** When the certificate this app is served with ends, or null where there is none to check. */
async function readCertificateEnd(): Promise<Date | null> {
  const url = new URL(getEnv().APP_URL);
  if (url.protocol !== "https:") return null;
  return new Promise((resolve, reject) => {
    const socket = connect(
      {
        host: url.hostname,
        port: Number(url.port) || 443,
        servername: url.hostname,
        rejectUnauthorized: false,
      },
      () => {
        const { valid_to: validTo } = socket.getPeerCertificate();
        socket.end();
        resolve(validTo ? parseCertificateDate(validTo) : null);
      },
    );
    socket.setTimeout(10_000, () => socket.destroy(new Error("certificate check timed out")));
    socket.on("error", reject);
  });
}

const byQueue = (rows: Array<{ name: string; count: number }>) =>
  rows.map((row) => `${row.name} (${row.count})`).join(", ");

/** The same fault groups together whatever IDs and numbers it mentions. */
export function errorFingerprint(msg: string, name: string, message: string): string {
  const general = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\d+/g, "#");
  return createHash("sha256").update(`${msg}|${name}|${general}`).digest("hex").slice(0, 32);
}

export function createMonitoringService({
  clock = systemClock,
  disk = readDisk,
  backupStamp = readBackupStamp,
  certificateEnd = readCertificateEnd,
}: {
  clock?: Clock;
  disk?: () => Promise<DiskSpace>;
  backupStamp?: () => Promise<Date | "off" | null>;
  certificateEnd?: () => Promise<Date | null>;
} = {}) {
  async function raise(code: AlertCode, detail: string): Promise<void> {
    const now = clock.now();
    const opened = await repository.open(code, detail, now);
    if (!opened) {
      await repository.touch(code, detail, now);
      return;
    }
    logger.error(`ALERT: ${ALERTS[code]}`, { alertCode: code, detail });
    const people = await listPeopleWhoCan("system:view-diagnostics");
    await notify({
      userIds: people.map((person) => person.id),
      kind: "system_alert",
      key: `alert:${opened.id}`,
      body: `${ALERTS[code]}. ${detail}`,
      link: "/diagnostics",
      urgent: true,
    });
  }

  const settle = async (code: AlertCode, detail: string | null) => {
    if (detail) await raise(code, detail);
    else await repository.resolve(code, clock.now());
  };

  async function checkWorker(): Promise<string | null> {
    const { lastBeatAt } = await getWorkerStatus();
    const last = lastBeatAt ? parseInstant(lastBeatAt).getTime() : null;
    if (last !== null && clock.now().getTime() - last <= WORKER_ALERT_AFTER_SECONDS * 1000) {
      return null;
    }
    return "Leads, timers and messages are waiting until it runs again.";
  }

  async function checkJobs(): Promise<void> {
    const now = clock.now();
    const health = await readJobHealth(now, {
      failedSince: plusDuration(now, { hours: -FAILED_LOOK_BACK_HOURS }),
      stuckGraceSeconds: STUCK_GRACE_SECONDS,
      waitingSince: plusDuration(now, { hours: -WAITING_TOO_LONG_HOURS }),
    });
    await settle("jobs_failed", health.failed.length > 0 ? byQueue(health.failed) : null);
    await settle("jobs_stuck", health.stuck.length > 0 ? byQueue(health.stuck) : null);
  }

  async function checkDisk(): Promise<void> {
    const { freeBytes, totalBytes } = await disk();
    const low = freeBytes < DISK_MIN_FREE_BYTES || freeBytes < totalBytes * DISK_MIN_FREE_RATIO;
    await settle(
      "disk_low",
      low
        ? `${(freeBytes / GIB).toFixed(1)} GB free of ${(totalBytes / GIB).toFixed(1)} GB.`
        : null,
    );
  }

  async function checkErrors(): Promise<void> {
    const since = plusDuration(hourOf(clock.now()), { hours: -1 });
    const count = await repository.countErrorsSince(since);
    await settle(
      "errors_spike",
      count >= ERROR_SPIKE_PER_HOUR ? `${count} in the last hour or two.` : null,
    );
  }

  async function checkBackup(): Promise<void> {
    const stamp = await backupStamp();
    if (stamp === "off") return;
    const stale =
      stamp === null || clock.now().getTime() - stamp.getTime() > BACKUP_STALE_HOURS * HOUR_MS;
    await settle(
      "backup_stale",
      stale
        ? stamp
          ? `The last one finished at ${toIsoInstant(stamp)}.`
          : "None has finished yet."
        : null,
    );
  }

  async function checkCertificate(): Promise<void> {
    const end = await certificateEnd();
    const days = end ? (end.getTime() - clock.now().getTime()) / (24 * HOUR_MS) : null;
    await settle(
      "certificate_expiring",
      days !== null && days < CERTIFICATE_WARNING_DAYS
        ? `${Math.max(0, Math.floor(days))} days left. It normally renews by itself, so check Caddy.`
        : null,
    );
  }

  const hourOf = (at: Date) => instantFromEpochMs(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);

  return {
    /** One failing check never stops the others. */
    async runChecks(): Promise<void> {
      const checks = [
        async () => settle("worker_down", await checkWorker()),
        checkJobs,
        checkDisk,
        checkErrors,
        checkBackup,
        checkCertificate,
      ];
      for (const check of checks) {
        await check().catch((error: unknown) =>
          logger.warn("a monitoring check could not run", { err: error }),
        );
      }
    },

    /** Called for every error logged. Never throws, and never logs at error level itself. */
    async recordError(record: LogRecord, source: string): Promise<void> {
      if (record.alertCode) return; // the alert itself, already handled
      const err = record.err as { name?: string; message?: string } | undefined;
      const name = err?.name ?? "Error";
      const message = String(err?.message ?? record.msg).slice(0, 500);
      const at = clock.now();
      await repository
        .recordError({
          fingerprint: errorFingerprint(record.msg, name, message),
          hourStart: hourOf(at),
          name: name.slice(0, 100),
          message: err?.message ? `${record.msg}: ${message}` : message,
          source,
          at,
          requestId: typeof record.requestId === "string" ? record.requestId : null,
        })
        .catch((error: unknown) => logger.warn("could not record an error", { err: error }));
    },

    async view(): Promise<MonitoringView> {
      const now = clock.now();
      const since = plusDuration(now, { days: -SCREEN_DAYS });
      const [alerts, errors, health, database, space] = await Promise.all([
        repository.listAlerts(since),
        repository.listErrors(since, 50),
        readJobHealth(now, {
          failedSince: plusDuration(now, { days: -1 }),
          stuckGraceSeconds: STUCK_GRACE_SECONDS,
          waitingSince: plusDuration(now, { hours: -WAITING_TOO_LONG_HOURS }),
        }),
        repository.databaseCapacity(),
        disk().catch(() => null),
      ]);
      return {
        alerts: alerts.map((alert) => ({
          id: alert.id,
          code: alert.code as AlertCode,
          title: ALERTS[alert.code as AlertCode] ?? alert.code,
          detail: alert.detail,
          openedAt: toIsoInstant(alert.openedAt),
          lastSeenAt: toIsoInstant(alert.lastSeenAt),
          resolvedAt: alert.resolvedAt ? toIsoInstant(alert.resolvedAt) : null,
        })),
        errors: errors.map((row) => ({ ...row, lastSeenAt: toIsoInstant(row.lastSeenAt) })),
        queues: health.queues,
        capacity: {
          connections: database.connections,
          maxConnections: database.maxConnections,
          databaseBytes: Number(database.sizeBytes),
          diskFreeBytes: space?.freeBytes ?? null,
          diskTotalBytes: space?.totalBytes ?? null,
          liveStreams: connectedStreams(),
        },
      };
    },

    async sweep(): Promise<void> {
      const now = clock.now();
      await repository.sweep(
        plusDuration(now, { days: -ERROR_RETENTION_DAYS }),
        plusDuration(now, { days: -ALERT_RETENTION_DAYS }),
      );
    },
  };
}

export const monitoringService = createMonitoringService();
