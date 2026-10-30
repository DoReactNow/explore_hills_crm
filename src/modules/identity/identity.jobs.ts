// Background jobs of the identity module. The clean-up is idempotent: a second run finds nothing.
import { z } from "zod";
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { createCleanupService } from "./identity.cleanup";

export const cleanupSessionsJob = defineJob({
  name: "identity.cleanupSessions",
  payload: z.object({}),
  retry: { limit: 3, delaySeconds: 60, backoff: true },
  async handler(_payload, { logger }) {
    const removed = await createCleanupService().run();
    logger.info("session clean-up done", removed);
  },
});

export const identityJobs: AnyJobDefinition[] = [cleanupSessionsJob];

export const identitySchedules: JobSchedule[] = [
  { job: cleanupSessionsJob, cron: "30 3 * * *", payload: {} },
];
