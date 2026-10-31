// Background jobs of the notifications module. All are idempotent.
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { sendEmailDef, sendPushDef, sweepDef } from "./notifications.jobdefs";
import { notificationService } from "./notifications.service";

const sendEmailJob = defineJob({
  ...sendEmailDef,
  handler: ({ notificationId }) => notificationService.sendEmail(notificationId),
});
const sendPushJob = defineJob({
  ...sendPushDef,
  handler: ({ notificationId }) => notificationService.sendPush(notificationId),
});
const sweepJob = defineJob({ ...sweepDef, handler: () => notificationService.sweep() });

export const notificationJobs: AnyJobDefinition[] = [sendEmailJob, sendPushJob, sweepJob];

export const notificationSchedules: JobSchedule[] = [
  { job: sweepJob, cron: "* * * * *", payload: {} },
];
