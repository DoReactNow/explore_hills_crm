// The jobs' names, payloads and retry policies, without their work, so the service can enqueue them
// and assignment.jobs.ts can run them without importing each other in a circle.
import { z } from "zod";
import { defineJob } from "@/shared/jobs";

const notHere = async () => {
  throw new Error("This job runs through assignment.jobs.ts");
};

export const timeoutDef = {
  name: "assignment.processTimeout",
  payload: z.object({ recordId: z.string() }),
  retry: { limit: 3, delaySeconds: 30, backoff: true },
};
export const expiryDef = {
  name: "assignment.expirePoolEntry",
  payload: z.object({ entryId: z.string() }),
  retry: { limit: 3, delaySeconds: 30, backoff: true },
};
export const sweepDef = {
  name: "assignment.sweep",
  payload: z.object({}),
  retry: { limit: 1, delaySeconds: 30, backoff: false },
};

export const timeoutRef = defineJob({ ...timeoutDef, handler: notHere });
export const expiryRef = defineJob({ ...expiryDef, handler: notHere });
