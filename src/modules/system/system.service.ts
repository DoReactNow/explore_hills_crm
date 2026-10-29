// System rules: health, diagnostics and the worker heartbeat. No HTTP types.
import type { Logger } from "@/shared/logger";
import { toIsoInstant, type Clock } from "@/shared/time";
import type { SystemRepository } from "./system.repository";
import type { Diagnostics, Health, WorkerStatus } from "./system.schemas";
import { WORKER_DOWN_AFTER_SECONDS } from "./system.types";

export interface SystemServiceDeps {
  repository: SystemRepository;
  clock: Clock;
  version: string;
  logger: Pick<Logger, "warn">;
}

export function createSystemService({ repository, clock, version, logger }: SystemServiceDeps) {
  async function getHealth(): Promise<Health> {
    let database: Health["database"] = "up";
    try {
      await repository.pingDatabase();
    } catch (error) {
      database = "down";
      logger.warn("health check: database did not answer", { err: error });
    }
    return {
      status: database === "up" ? "ok" : "degraded",
      database,
      version,
      time: toIsoInstant(clock.now()),
    };
  }

  async function getWorkerStatus(): Promise<WorkerStatus> {
    const latest = await repository.latestHeartbeat();
    if (!latest) return { state: "down", lastBeatAt: null };
    const ageMs = clock.now().getTime() - latest.lastBeatAt.getTime();
    return {
      state: ageMs <= WORKER_DOWN_AFTER_SECONDS * 1000 ? "up" : "down",
      lastBeatAt: toIsoInstant(latest.lastBeatAt),
    };
  }

  return {
    getHealth,
    getWorkerStatus,

    async getDiagnostics(): Promise<Diagnostics> {
      const health = await getHealth();
      const worker =
        health.database === "up"
          ? await getWorkerStatus()
          : ({ state: "down", lastBeatAt: null } as const);
      return { ...health, worker };
    },

    /** Called by the worker every few seconds (Decision 27). */
    async recordHeartbeat({
      workerId,
      startedAt,
    }: {
      workerId: string;
      startedAt: Date;
    }): Promise<void> {
      await repository.upsertHeartbeat({ workerId, version, startedAt, lastBeatAt: clock.now() });
    },
  };
}

export type SystemService = ReturnType<typeof createSystemService>;
