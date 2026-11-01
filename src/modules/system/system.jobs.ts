// Background jobs of the system module. The test-only probe job proves the queue, retries and delayed
// jobs, and the worker registers it only when APP_ENV=test.
import { z } from "zod";
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { runFileDeletions } from "./system.fileDeletion";

const deleteFilesJob = defineJob({
  name: "system.deleteFiles",
  payload: z.object({}),
  retry: { limit: 1, delaySeconds: 60, backoff: false },
  handler: async () => {
    await runFileDeletions();
  },
});

export const systemJobs: AnyJobDefinition[] = [deleteFilesJob];
export const systemSchedules: JobSchedule[] = [
  { job: deleteFilesJob, cron: "*/5 * * * *", payload: {} },
];

const probeRuns = new Map<string, number>();

export const testProbeJob = defineJob({
  name: "system.testProbe",
  payload: z.object({ key: z.string().min(1), fail: z.boolean().optional() }),
  retry: { limit: 2, delaySeconds: 10, backoff: false },
  async handler({ key, fail }) {
    probeRuns.set(key, (probeRuns.get(key) ?? 0) + 1);
    if (fail) throw new Error("test probe asked to fail");
  },
});

export const systemTestJobs = [testProbeJob];

export const getTestProbeRuns = (key: string) => probeRuns.get(key) ?? 0;
export const resetTestProbeRuns = () => probeRuns.clear();
