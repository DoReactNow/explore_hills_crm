// The shape of the health and diagnostics responses, shared by the service, controller and tests.
import { z } from "zod";
import { DATABASE_STATES, WORKER_STATES } from "./system.types";

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(DATABASE_STATES),
  version: z.string(),
  time: z.iso.datetime(),
});

export type Health = z.infer<typeof healthSchema>;

export const workerStatusSchema = z.object({
  state: z.enum(WORKER_STATES),
  lastBeatAt: z.iso.datetime().nullable(),
});

export type WorkerStatus = z.infer<typeof workerStatusSchema>;

export const diagnosticsSchema = healthSchema.extend({ worker: workerStatusSchema });

export type Diagnostics = z.infer<typeof diagnosticsSchema>;
