// pg-boss lives behind this folder only (architecture rule 8). Its tables are in the "pgboss"
// schema, which Prisma does not manage and the drift check ignores.
import { createHash } from "node:crypto";
import { PgBoss, type ConstructorOptions } from "pg-boss";
import { APP_CONFIG } from "@/shared/config/appConfig";
import type { Logger } from "@/shared/logger";
import { parsePayload, type AnyJobDefinition } from "./defineJob";
import { executeJob } from "./executeJob";
import type { EnqueueOptions, JobQueue } from "./jobQueue";

export type { PgBoss };
export const PGBOSS_SCHEMA = "pgboss";

export interface CreatePgBossOptions {
  connectionString: string;
  /** Workers run maintenance and cron; the web app and tests only enqueue or fetch. */
  role: "worker" | "client";
  /** pg-boss clock (integration tests pass pg-boss's TestClock). */
  clock?: ConstructorOptions["clock"];
}

export function createPgBoss({ connectionString, role, clock }: CreatePgBossOptions): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: `explorehills-${role}`,
    supervise: role === "worker",
    schedule: role === "worker",
    ...(clock ? { clock } : {}),
  });
}

const createdQueues = new WeakMap<PgBoss, Set<string>>();

/** Creates the job's queue once per pg-boss instance, with its retry policy. */
export async function ensureQueue(boss: PgBoss, job: AnyJobDefinition): Promise<void> {
  let names = createdQueues.get(boss);
  if (!names) createdQueues.set(boss, (names = new Set()));
  if (names.has(job.name)) return;
  if (!(await boss.getQueue(job.name))) {
    await boss.createQueue(job.name, {
      retryLimit: job.retry.limit,
      retryDelay: job.retry.delaySeconds,
      retryBackoff: job.retry.backoff,
    });
  }
  names.add(job.name);
}

/**
 * The job ID for an idempotency key: a UUID derived from the job name and the key. pg-boss inserts
 * with ON CONFLICT DO NOTHING, so a second job with the same key is not created (send returns
 * null). On a standard queue pg-boss's own singletonKey does not prevent duplicates.
 */
export function keyedJobId(jobName: string, key: string): string {
  const hex = createHash("sha256")
    .update(`${jobName}\u0000${key}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "8"; // UUID version 8 (custom)
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // RFC 4122 variant
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sendOptions(job: AnyJobDefinition, options: EnqueueOptions = {}) {
  return {
    retryLimit: job.retry.limit,
    retryDelay: job.retry.delaySeconds,
    retryBackoff: job.retry.backoff,
    ...(options.singletonKey
      ? { id: keyedJobId(job.name, options.singletonKey), singletonKey: options.singletonKey }
      : {}),
  };
}

export function createPgBossJobQueue(boss: PgBoss): JobQueue {
  return {
    async enqueue(job, payload, options) {
      const data = parsePayload(job, payload) as object;
      await ensureQueue(boss, job);
      return boss.send(job.name, data, sendOptions(job, options));
    },
    async enqueueAt(job, payload, at, options) {
      const data = parsePayload(job, payload) as object;
      await ensureQueue(boss, job);
      return boss.send(job.name, data, { ...sendOptions(job, options), startAfter: at });
    },
    async schedule(job, cron, payload, options) {
      const data = parsePayload(job, payload) as object;
      await ensureQueue(boss, job);
      await boss.schedule(job.name, cron, data, {
        tz: options?.timezone ?? APP_CONFIG.locale.businessTimezone,
      });
    },
    async cancel(job, id) {
      await boss.cancel(job.name, id);
    },
  };
}

/** Worker side: subscribe a pg-boss worker for every job. The web app never calls this. */
export async function startJobWorkers(
  boss: PgBoss,
  jobs: Iterable<AnyJobDefinition>,
  logger: Pick<Logger, "info" | "warn" | "error">,
): Promise<void> {
  for (const job of jobs) {
    await ensureQueue(boss, job);
    await boss.work(job.name, { includeMetadata: true, batchSize: 1 }, async ([attempt]) => {
      await executeJob(job, attempt, logger);
    });
  }
}
