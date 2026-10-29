// The worker process (Decision 27): runs every module's background jobs and writes a heartbeat.
// `npm run worker` in development; the "worker" service in Docker. The web app only enqueues.
import { hostname } from "node:os";
import { HEARTBEAT_INTERVAL_SECONDS, workerStatusChangedEvent } from "@/modules/system";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { createPgBoss, startJobWorkers } from "@/shared/jobs/pgBoss";
import { logger } from "@/shared/logger";
import { closePublisher, publishEvent } from "@/shared/realtime/publish";
import { getFileStorage } from "@/shared/storage";
import { startHeartbeat } from "./heartbeat";
import { collectWorkerJobs } from "./workerJobs";

async function main(): Promise<void> {
  const env = getEnv();
  getFileStorage(); // fail at startup, not on the first recording, when the storage driver is wrong
  const workerId = `${hostname()}:${process.pid}`;
  const jobs = collectWorkerJobs(env.APP_ENV);

  const boss = createPgBoss({ connectionString: env.DATABASE_URL, role: "worker" });
  boss.on("error", (error) => logger.error("pg-boss error", { err: error }));
  await boss.start(); // creates or migrates the pgboss schema
  await startJobWorkers(boss, jobs.values(), logger);
  const heartbeat = await startHeartbeat({
    workerId,
    intervalMs: HEARTBEAT_INTERVAL_SECONDS * 1000,
  });
  logger.info("worker started", { workerId, jobs: [...jobs.keys()] });
  await notifyStatusChanged(workerId);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("worker stopping", { signal });
    heartbeat.stop();
    await boss.stop({ graceful: true, timeout: 10_000 });
    await notifyStatusChanged(workerId);
    await closePublisher();
    await getPrisma().$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/** Tells open diagnostics screens to re-fetch; a failure here never stops the worker. */
async function notifyStatusChanged(workerId: string): Promise<void> {
  await publishEvent(workerStatusChangedEvent, { workerId }).catch((error: unknown) =>
    logger.warn("could not publish the worker status notice", { err: error }),
  );
}

main().catch((error: unknown) => {
  logger.fatal("worker failed to start", { err: error });
  process.exit(1);
});
