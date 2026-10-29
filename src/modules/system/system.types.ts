export const DATABASE_STATES = ["up", "down"] as const;
export type DatabaseState = (typeof DATABASE_STATES)[number];

export const WORKER_STATES = ["up", "down"] as const;
export type WorkerState = (typeof WORKER_STATES)[number];

/** How often the worker writes its heartbeat. */
export const HEARTBEAT_INTERVAL_SECONDS = 5;
/** Diagnostics reports the worker down when its last heartbeat is older than this. */
export const WORKER_DOWN_AFTER_SECONDS = 30;
