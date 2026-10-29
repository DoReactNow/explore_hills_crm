import { describe, expect, it, vi } from "vitest";
import { createSystemService } from "../system.service";
import type { SystemRepository } from "../system.repository";

const clock = { now: () => new Date("2026-12-31T18:35:00.000Z") };

function service(repository: SystemRepository) {
  return createSystemService({ repository, clock, version: "1.2.3", logger: { warn: vi.fn() } });
}

describe("system service: health", () => {
  it("reports ok, the version and the clock's instant when the database answers", async () => {
    const repository = { pingDatabase: vi.fn().mockResolvedValue(undefined) };
    await expect(service(repository).getHealth()).resolves.toEqual({
      status: "ok",
      database: "up",
      version: "1.2.3",
      time: "2026-12-31T18:35:00.000Z",
    });
    expect(repository.pingDatabase).toHaveBeenCalledOnce();
  });

  it("reports the database as down, without throwing, when the ping fails", async () => {
    const repository = { pingDatabase: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    const result = await service(repository).getHealth();
    expect(result).toMatchObject({ status: "degraded", database: "down" });
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
  });
});
