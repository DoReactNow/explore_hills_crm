// HTTP side of the system module. Imported only by src/app (architecture rule 2).
import { APP_VERSION } from "@/shared/config/version";
import type { HandlerResult } from "@/shared/http/route";
import { logger } from "@/shared/logger";
import { systemClock } from "@/shared/time/clock";
import { systemRepository } from "./system.repository";
import type { Health } from "./system.schemas";
import { createSystemService, type SystemService } from "./system.service";

export function createSystemController(service: SystemService) {
  return {
    /** GET /api/health: 200 when the database answers, 503 when it does not. */
    async health(): Promise<HandlerResult<Health>> {
      const health = await service.getHealth();
      return { status: health.database === "up" ? 200 : 503, data: health };
    },

    /** GET /api/diagnostics: health detail for operators (W-012 adds the worker and jobs). */
    async diagnostics(): Promise<HandlerResult<Health>> {
      return { data: await service.getHealth() };
    },
  };
}

export const systemController = createSystemController(
  createSystemService({
    repository: systemRepository,
    clock: systemClock,
    version: APP_VERSION,
    logger,
  }),
);
