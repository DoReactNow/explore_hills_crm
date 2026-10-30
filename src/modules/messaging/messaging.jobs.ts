// Background jobs of the messaging module. All are idempotent: a repeat finds the work already done.
import { defineJob, type AnyJobDefinition } from "@/shared/jobs";
import { downloadMediaDef, processEventDef, sendMessageDef } from "./messaging.jobdefs";
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

export const messagingJobs: AnyJobDefinition[] = [
  processEventJob,
  sendMessageJob,
  downloadMediaJob,
];
