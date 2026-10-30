// Public API of the system module: the only entry point for other modules and the worker.
import { systemService } from "./system.instance";

export type { Diagnostics, Health, WorkerStatus } from "./system.schemas";
export {
  DATABASE_STATES,
  HEARTBEAT_INTERVAL_SECONDS,
  WORKER_DOWN_AFTER_SECONDS,
  WORKER_STATES,
  type DatabaseState,
  type WorkerState,
} from "./system.types";
export { getTestProbeRuns, resetTestProbeRuns, systemJobs, systemTestJobs } from "./system.jobs";
export { systemEventTypes, systemTestEventTypes, workerStatusChangedEvent } from "./system.events";

export { ensureDefaultSettings, getSetting } from "./system.settings.service";
export type { SettingKey } from "./system.settings";

export const recordWorkerHeartbeat = systemService.recordHeartbeat;
