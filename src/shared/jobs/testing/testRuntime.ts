// Integration-test helpers: a real pg-boss on the test database, driven by pg-boss's TestClock,
// which keeps JavaScript and Postgres on the same hand-moved time. No test waits on real time,
// and none needs a running worker: runPendingJobs() runs every due job in-process.
import { TestClock } from "pg-boss";
import { getEnv } from "@/shared/config/env";
import type { AnyJobDefinition } from "../defineJob";
import { executeJob } from "../executeJob";
import type { JobQueue } from "../jobQueue";
import { createPgBoss, createPgBossJobQueue, ensureQueue, type PgBoss } from "../pgBoss";
import type { Logger } from "@/shared/logger";

export interface TestJobRuntime {
  boss: PgBoss;
  clock: TestClock;
  queue: JobQueue;
  /** Runs every due job of the given definitions until none is left; returns how many ran. */
  runPendingJobs(
    jobs: ReadonlyArray<AnyJobDefinition>,
    options?: { logger?: Pick<Logger, "info" | "warn" | "error"> },
  ): Promise<number>;
  jobState(job: AnyJobDefinition, id: string): Promise<string | null>;
  stop(): Promise<void>;
}

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

export async function startTestJobRuntime({ start }: { start: string }): Promise<TestJobRuntime> {
  const env = getEnv();
  if (env.APP_ENV !== "test")
    throw new Error("startTestJobRuntime may only be used when APP_ENV=test");
  const clock = new TestClock(start);
  const boss = createPgBoss({ connectionString: env.DATABASE_URL, role: "client", clock });
  boss.on("error", () => undefined);
  await boss.start();

  return {
    boss,
    clock,
    queue: createPgBossJobQueue(boss),
    async runPendingJobs(jobs, options = {}) {
      const logger = options.logger ?? quiet;
      let ran = 0;
      for (const job of jobs) {
        await ensureQueue(boss, job);
        for (;;) {
          const batch = await boss.fetch(job.name, { batchSize: 20, includeMetadata: true });
          if (batch.length === 0) break;
          for (const attempt of batch) {
            ran++;
            try {
              await executeJob(job, attempt, logger);
              await boss.complete(job.name, attempt.id);
            } catch (error) {
              await boss.fail(job.name, attempt.id, {
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
      return ran;
    },
    async jobState(job, id) {
      return (await boss.getJobById(job.name, id))?.state ?? null;
    },
    async stop() {
      await boss.stop({ graceful: false, close: true });
    },
  };
}
