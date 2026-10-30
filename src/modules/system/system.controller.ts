// HTTP side of the system module. Imported only by src/app (architecture rule 2).
import { z } from "zod";
import { AppError } from "@/shared/errors";
import type { HandlerResult, RouteContext } from "@/shared/http/route";
import { settingsService } from "./system.settings.service";
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

const updateSettingInput = z.object({ key: z.string(), value: z.unknown() });

export { updateSettingInput as updateSettingSchema };

export const settingsController = {
  async list({ principal }: RouteContext<undefined, Record<string, string>>) {
    if (!principal) throw new AppError("UNAUTHENTICATED");
    return { data: await settingsService.listSettings(principal) };
  },
  async update({
    principal,
    requestId,
    input,
  }: RouteContext<z.output<typeof updateSettingInput>, Record<string, string>>) {
    if (!principal) throw new AppError("UNAUTHENTICATED");
    return {
      data: await settingsService.updateSetting({ principal, requestId }, input.key, input.value),
    };
  },
};

export const systemController = createSystemController(systemService);
