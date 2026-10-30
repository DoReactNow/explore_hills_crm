// The jobs' names, payloads and retry policies, without their work, so the service can enqueue them
// and messaging.jobs.ts can run them without importing each other in a circle.
import { z } from "zod";
import { defineJob } from "@/shared/jobs";

const notHere = async () => {
  throw new Error("This job runs through messaging.jobs.ts");
};

export const processEventDef = {
  name: "messaging.processWebhookEvent",
  payload: z.object({ eventId: z.string() }),
  retry: { limit: 5, delaySeconds: 30, backoff: true },
};
export const sendMessageDef = {
  name: "messaging.sendMessage",
  payload: z.object({ messageId: z.string() }),
  retry: { limit: 6, delaySeconds: 30, backoff: true },
};
export const downloadMediaDef = {
  name: "messaging.downloadMedia",
  payload: z.object({ messageId: z.string() }),
  retry: { limit: 3, delaySeconds: 60, backoff: true },
};

export const processEventRef = defineJob({ ...processEventDef, handler: notHere });
export const sendMessageRef = defineJob({ ...sendMessageDef, handler: notHere });
export const downloadMediaRef = defineJob({ ...downloadMediaDef, handler: notHere });
