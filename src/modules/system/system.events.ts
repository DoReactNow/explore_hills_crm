// Live-update event types of the system module (Decision 28). Payloads carry IDs only.
import { z } from "zod";
import { can } from "@/shared/rbac/guard";
import { defineEventType } from "@/shared/realtime";

/** The worker started or stopped: diagnostics screens re-fetch the worker status. */
export const workerStatusChangedEvent = defineEventType({
  name: "system.workerStatusChanged",
  payload: z.object({ workerId: z.string() }),
  canReceive: (principal) => can(principal, "system:view-diagnostics"),
});

export const systemEventTypes = [workerStatusChangedEvent];

/** Test-only (registered when APP_ENV=test): proves delivery and per-user filtering end to end. */
export const testPingEvent = defineEventType({
  name: "system.testPing",
  payload: z.object({ targetUserId: z.string() }),
  canReceive: (principal, payload) => principal.userId === payload.targetUserId,
});

export const systemTestEventTypes = [testPingEvent];
