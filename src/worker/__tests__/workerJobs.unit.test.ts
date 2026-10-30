import { describe, expect, it } from "vitest";
import { collectWorkerJobs, collectWorkerSchedules } from "../workerJobs";

describe("worker job list", () => {
  it("includes the test-only job only when APP_ENV=test", () => {
    expect([...collectWorkerJobs("test").keys()]).toContain("system.testProbe");
    expect([...collectWorkerJobs("development").keys()]).not.toContain("system.testProbe");
    expect([...collectWorkerJobs("production").keys()]).not.toContain("system.testProbe");
  });

  it("runs and schedules the session clean-up in every environment", () => {
    for (const env of ["test", "development", "production"] as const) {
      expect([...collectWorkerJobs(env).keys()]).toContain("identity.cleanupSessions");
    }
    expect(collectWorkerSchedules().map(({ job }) => job.name)).toContain(
      "identity.cleanupSessions",
    );
  });
});
