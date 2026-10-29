import { describe, expect, it } from "vitest";
import { collectWorkerJobs } from "../workerJobs";

describe("worker job list", () => {
  it("includes the test-only job only when APP_ENV=test", () => {
    expect([...collectWorkerJobs("test").keys()]).toContain("system.testProbe");
    expect([...collectWorkerJobs("development").keys()]).not.toContain("system.testProbe");
    expect([...collectWorkerJobs("production").keys()]).not.toContain("system.testProbe");
  });
});
