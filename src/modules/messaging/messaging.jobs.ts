// Background jobs of the messaging module. All are idempotent: a repeat finds the work already done.
import { z } from "zod";
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { downloadMediaDef, processEventDef, sendMessageDef } from "./messaging.jobdefs";
import { messagingRetention } from "./messaging.retention";
import { messagingService } from "./messaging.service";

export const processEventJob = defineJob({
  ...processEventDef,
  handler: ({ eventId }) => messagingService.processEvent(eventId),
});

export const sendMessageJob = defineJob({
  ...sendMessageDef,
  handler: ({ messageId }, { isFinalAttempt }) =>
    messagingService.runSend(messageId, Boolean(isFinalAttempt)),
});

export const downloadMediaJob = defineJob({
  ...downloadMediaDef,
  handler: ({ messageId }, { isFinalAttempt }) =>
    messagingService.runDownload(messageId, Boolean(isFinalAttempt)),
});

const deleteOldMessagesJob = defineJob({
  name: "messaging.deleteOldMessages",
  payload: z.object({}),
  retry: { limit: 3, delaySeconds: 300, backoff: true },
  handler: async () => {
    await messagingRetention.deleteOldMessages();
  },
});

const deleteOldWebhookEventsJob = defineJob({
  name: "messaging.deleteOldWebhookEvents",
  payload: z.object({}),
  retry: { limit: 3, delaySeconds: 300, backoff: true },
  handler: async () => {
    await messagingRetention.deleteOldWebhookEvents();
  },
});

export const messagingJobs: AnyJobDefinition[] = [
  processEventJob,
  sendMessageJob,
  downloadMediaJob,
  deleteOldMessagesJob,
  deleteOldWebhookEventsJob,
];

export const messagingSchedules: JobSchedule[] = [
  { job: deleteOldMessagesJob, cron: "30 4 * * *", payload: {} },
  { job: deleteOldWebhookEventsJob, cron: "45 4 * * *", payload: {} },
];
