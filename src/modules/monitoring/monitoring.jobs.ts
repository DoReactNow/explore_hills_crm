// The daily clear-out of old errors and alerts. The checks themselves run in the app (monitoring.watch.ts).
import { z } from "zod";
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { monitoringService } from "./monitoring.service";

const sweepJob = defineJob({
  name: "monitoring.sweep",
  payload: z.object({}),
  retry: { limit: 1, delaySeconds: 60, backoff: false },
  handler: () => monitoringService.sweep(),
});

export const monitoringJobs: AnyJobDefinition[] = [sweepJob];
export const monitoringSchedules: JobSchedule[] = [
  { job: sweepJob, cron: "23 3 * * *", payload: {} },
];
