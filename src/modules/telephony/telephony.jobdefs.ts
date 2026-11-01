// The jobs' names, payloads and retry policies, without their work, so the service can enqueue them
// and telephony.jobs.ts can run them without importing each other in a circle.
import { z } from "zod";
import { defineJob } from "@/shared/jobs";

const notHere = async () => {
  throw new Error("This job runs through telephony.jobs.ts");
};

export const processEventDef = {
  name: "telephony.processWebhookEvent",
  payload: z.object({ eventId: z.string() }),
  retry: { limit: 5, delaySeconds: 30, backoff: true },
};
export const storeRecordingDef = {
  name: "telephony.storeRecording",
  payload: z.object({ callId: z.string() }),
  retry: { limit: 5, delaySeconds: 60, backoff: true },
};
export const sweepDef = {
  name: "telephony.sweep",
  payload: z.object({}),
  retry: { limit: 1, delaySeconds: 30, backoff: false },
};
export const retentionDef = {
  name: "telephony.deleteExpiredRecordings",
  payload: z.object({}),
  retry: { limit: 3, delaySeconds: 300, backoff: true },
};

export const webhookRetentionDef = {
  name: "telephony.deleteOldWebhookEvents",
  payload: z.object({}),
  retry: { limit: 3, delaySeconds: 300, backoff: true },
};

export const processEventRef = defineJob({ ...processEventDef, handler: notHere });
export const storeRecordingRef = defineJob({ ...storeRecordingDef, handler: notHere });
