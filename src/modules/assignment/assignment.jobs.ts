// Background jobs of the assignment module. All are idempotent. The delayed jobs act on time, and the
// minute sweep catches anything they lost, so running both together still acts once.
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { expiryDef, sweepDef, timeoutDef } from "./assignment.jobdefs";
import { assignmentService } from "./assignment.service";

export const timeoutJob = defineJob({
  ...timeoutDef,
  handler: ({ recordId }) => assignmentService.processTimeout(recordId),
});

export const expiryJob = defineJob({
  ...expiryDef,
  handler: ({ entryId }) => assignmentService.expirePoolEntry(entryId),
});

export const sweepJob = defineJob({
  ...sweepDef,
  handler: () => assignmentService.sweep(),
});

export const assignmentJobs: AnyJobDefinition[] = [timeoutJob, expiryJob, sweepJob];

export const assignmentSchedules: JobSchedule[] = [
  { job: sweepJob, cron: "* * * * *", payload: {} },
];
