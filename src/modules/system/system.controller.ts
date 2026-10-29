// HTTP side of the system module. Imported only by src/app (architecture rule 2).
import type { HandlerResult } from "@/shared/http/route";
import type { Diagnostics, Health } from "./system.schemas";
import { systemService } from "./system.instance";
import type { SystemService } from "./system.service";

export function createSystemController(service: SystemService) {
  return {
    /** GET /api/health: 200 when the database answers, 503 when it does not. */
    async health(): Promise<HandlerResult<Health>> {
      const health = await service.getHealth();
      return { status: health.database === "up" ? 200 : 503, data: health };
    },

    /** GET /api/diagnostics: health detail and the worker status, for operators. */
    async diagnostics(): Promise<HandlerResult<Diagnostics>> {
      return { data: await service.getDiagnostics() };
    },
  };
}

export const systemController = createSystemController(systemService);
