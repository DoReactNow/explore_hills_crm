import { describe, expect, it, vi } from "vitest";
import { createTestClock, parseInstant } from "@/shared/time";
import { createSystemService } from "../system.service";
import { WORKER_DOWN_AFTER_SECONDS } from "../system.types";

function service(lastBeatAt: string | null) {
  const clock = createTestClock("2027-01-01T00:00:00Z");
  const repository = {
    pingDatabase: vi.fn().mockResolvedValue(undefined),
    latestHeartbeat: vi
      .fn()
      .mockResolvedValue(lastBeatAt ? { lastBeatAt: parseInstant(lastBeatAt) } : null),
    upsertHeartbeat: vi.fn().mockResolvedValue(undefined),
  };
  return {
    clock,
    repository,
    service: createSystemService({ repository, clock, version: "1", logger: { warn: vi.fn() } }),
  };
}

describe("worker status", () => {
  it("is up when the last heartbeat is recent", async () => {
    const { service: s } = service("2026-12-31T23:59:50Z");
    await expect(s.getWorkerStatus()).resolves.toEqual({
      state: "up",
      lastBeatAt: "2026-12-31T23:59:50.000Z",
    });
  });

  it("is down when the last heartbeat is older than the threshold", async () => {
    const at = "2026-12-31T23:58:00Z"; // 120 s before the clock
    expect(WORKER_DOWN_AFTER_SECONDS).toBeLessThan(120);
    const { service: s } = service(at);
    await expect(s.getWorkerStatus()).resolves.toMatchObject({ state: "down" });
  });

  it("is down when there has never been a heartbeat", async () => {
    const { service: s } = service(null);
    await expect(s.getWorkerStatus()).resolves.toEqual({ state: "down", lastBeatAt: null });
  });

  it("records a heartbeat with the clock's time", async () => {
    const { service: s, repository } = service(null);
    await s.recordHeartbeat({
      workerId: "host:1",
      startedAt: parseInstant("2026-12-31T23:00:00Z"),
    });
    expect(repository.upsertHeartbeat).toHaveBeenCalledWith({
      workerId: "host:1",
      version: "1",
      startedAt: parseInstant("2026-12-31T23:00:00Z"),
      lastBeatAt: parseInstant("2027-01-01T00:00:00Z"),
    });
  });
});
