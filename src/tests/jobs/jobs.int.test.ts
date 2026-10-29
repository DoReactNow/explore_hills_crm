// W-012: jobs on the real queue (pg-boss in the test database), with pg-boss's TestClock driving
// time on both the JavaScript and the Postgres side. No test waits on real time.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestProbeRuns, resetTestProbeRuns, systemTestJobs } from "@/modules/system";
import { startTestJobRuntime, type TestJobRuntime } from "@/shared/jobs/testing/testRuntime";
import { instantFromEpochMs } from "@/shared/time";
import { resetDatabase } from "@/tests/setup/resetDatabase";

const [probe] = systemTestJobs;
let runtime: TestJobRuntime;

beforeAll(async () => {
  await resetDatabase();
  runtime = await startTestJobRuntime({ start: "2027-01-01T00:00:00Z" });
});
afterEach(async () => {
  resetTestProbeRuns();
  await resetDatabase();
});
afterAll(() => runtime.stop());

const run = (logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }) =>
  runtime.runPendingJobs(systemTestJobs, { logger });

describe("background jobs", () => {
  it("runs an enqueued job exactly once", async () => {
    await runtime.queue.enqueue(probe, { key: "once" });
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    expect(getTestProbeRuns("once")).toBe(1);
  });

  it("runs a job enqueued twice with the same singleton key only once", async () => {
    const first = await runtime.queue.enqueue(probe, { key: "dup" }, { singletonKey: "dup" });
    const second = await runtime.queue.enqueue(probe, { key: "dup" }, { singletonKey: "dup" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await run();
    expect(getTestProbeRuns("dup")).toBe(1);
  });

  it("rejects an invalid payload before it reaches the queue", async () => {
    await expect(runtime.queue.enqueue(probe, { key: 5 } as never)).rejects.toThrow(
      /system.testProbe/,
    );
  });

  it("retries a failing job per its policy, then fails it and raises an alert with the job ID", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const id = await runtime.queue.enqueue(probe, { key: "boom", fail: true });
    const { limit, delaySeconds } = probe.retry;

    await run(logger); // attempt 1
    expect(getTestProbeRuns("boom")).toBe(1);
    await run(logger); // the retry is not due yet
    expect(getTestProbeRuns("boom")).toBe(1);

    for (let attempt = 2; attempt <= limit + 1; attempt++) {
      await runtime.clock.tick((delaySeconds + 1) * 1000);
      await run(logger);
      expect(getTestProbeRuns("boom")).toBe(attempt);
    }
    await runtime.clock.tick((delaySeconds + 1) * 1000);
    await run(logger);
    expect(getTestProbeRuns("boom")).toBe(limit + 1); // no attempt after the final failure

    expect(await runtime.jobState(probe, id!)).toBe("failed");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/alert/i),
      expect.objectContaining({ jobId: id, job: "system.testProbe" }),
    );
    expect(logger.warn).toHaveBeenCalledTimes(limit);
  });

  it("does not run a delayed job before its time, and runs it once the clock passes it", async () => {
    const at = instantFromEpochMs(runtime.clock.now() + 60_000);
    await runtime.queue.enqueueAt(probe, { key: "later" }, at);

    expect(await run()).toBe(0);
    await runtime.clock.tick(59_000);
    expect(await run()).toBe(0);
    await runtime.clock.tick(2_000);
    expect(await run()).toBe(1);
    expect(getTestProbeRuns("later")).toBe(1);
  });

  it("can cancel a delayed job", async () => {
    const id = await runtime.queue.enqueueAt(
      probe,
      { key: "cancelled" },
      instantFromEpochMs(runtime.clock.now() + 1000),
    );
    await runtime.queue.cancel(probe, id!);
    await runtime.clock.tick(5_000);
    expect(await run()).toBe(0);
  });
});
