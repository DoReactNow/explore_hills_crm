// System rules: health and (from W-012) diagnostics. No HTTP types.
import type { Logger } from "@/shared/logger";
import type { Clock } from "@/shared/time/clock";
import type { SystemRepository } from "./system.repository";
import type { Health } from "./system.schemas";

export interface SystemServiceDeps {
  repository: SystemRepository;
  clock: Clock;
  version: string;
  logger: Pick<Logger, "warn">;
}

export function createSystemService({ repository, clock, version, logger }: SystemServiceDeps) {
  return {
    async getHealth(): Promise<Health> {
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
        time: clock.now().toISOString(),
      };
    },
  };
}

export type SystemService = ReturnType<typeof createSystemService>;
