// Background jobs of the telephony module. All are idempotent: a repeat finds the work already done.
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { processEventDef, retentionDef, storeRecordingDef, sweepDef } from "./telephony.jobdefs";
import { telephonyService } from "./telephony.service";

const processEventJob = defineJob({
  ...processEventDef,
  handler: ({ eventId }) => telephonyService.processEvent(eventId),
});
const storeRecordingJob = defineJob({
  ...storeRecordingDef,
  handler: ({ callId }, { isFinalAttempt }) =>
    telephonyService.storeRecording(callId, Boolean(isFinalAttempt)),
});
const sweepJob = defineJob({ ...sweepDef, handler: () => telephonyService.sweep() });
const retentionJob = defineJob({
  ...retentionDef,
  handler: async () => {
    await telephonyService.deleteExpiredRecordings();
  },
});

export const telephonyJobs: AnyJobDefinition[] = [
  processEventJob,
  storeRecordingJob,
  sweepJob,
  retentionJob,
];

export const telephonySchedules: JobSchedule[] = [
  { job: sweepJob, cron: "* * * * *", payload: {} },
  { job: retentionJob, cron: "15 4 * * *", payload: {} },
];
