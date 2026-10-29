// The web app's queue: it only enqueues (the worker runs jobs). Started lazily on first use.
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/logger";
import type { JobQueue } from "./jobQueue";
import { createPgBoss, createPgBossJobQueue, type PgBoss } from "./pgBoss";

const holder = globalThis as unknown as {
  explorehillsJobQueue?: Promise<{ boss: PgBoss; queue: JobQueue }>;
};

export async function getJobQueue(): Promise<JobQueue> {
  holder.explorehillsJobQueue ??= (async () => {
    const boss = createPgBoss({ connectionString: getEnv().DATABASE_URL, role: "client" });
    boss.on("error", (error) => logger.error("job queue error", { err: error }));
    await boss.start();
    return { boss, queue: createPgBossJobQueue(boss) };
  })();
  return (await holder.explorehillsJobQueue).queue;
}
