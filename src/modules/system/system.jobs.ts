// Background jobs of the system module. Phase 0 has none for production; the test-only probe job
// proves the queue, retries and delayed jobs, and the worker registers it only when APP_ENV=test.
import { z } from "zod";
import { defineJob, type AnyJobDefinition } from "@/shared/jobs";

export const systemJobs: AnyJobDefinition[] = [];

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
