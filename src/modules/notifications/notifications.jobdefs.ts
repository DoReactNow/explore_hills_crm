// The jobs' names, payloads and retry policies, without their work, so the service can enqueue them
// and notifications.jobs.ts can run them without importing each other in a circle.
import { z } from "zod";
import { defineJob } from "@/shared/jobs";

const notHere = async () => {
  throw new Error("This job runs through notifications.jobs.ts");
};

export const sendEmailDef = {
  name: "notifications.sendEmail",
  payload: z.object({ notificationId: z.string() }),
  retry: { limit: 5, delaySeconds: 60, backoff: true },
};
export const sendPushDef = {
  name: "notifications.sendPush",
  payload: z.object({ notificationId: z.string() }),
  retry: { limit: 3, delaySeconds: 60, backoff: true },
};
export const sweepDef = {
  name: "notifications.sweep",
  payload: z.object({}),
  retry: { limit: 1, delaySeconds: 30, backoff: false },
};

export const sendEmailRef = defineJob({ ...sendEmailDef, handler: notHere });
export const sendPushRef = defineJob({ ...sendPushDef, handler: notHere });
