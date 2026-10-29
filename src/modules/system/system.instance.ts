// The system service wired with its real dependencies. Used by the controller and the public API.
import { APP_VERSION } from "@/shared/config/version";
import { logger } from "@/shared/logger";
import { systemClock } from "@/shared/time";
import { systemRepository } from "./system.repository";
import { createSystemService } from "./system.service";

export const systemService = createSystemService({
  repository: systemRepository,
  clock: systemClock,
  version: APP_VERSION,
  logger,
});
