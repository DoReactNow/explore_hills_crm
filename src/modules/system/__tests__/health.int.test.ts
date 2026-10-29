import { afterAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { getPrisma } from "@/shared/db/prisma";
import { route } from "@/shared/http/route";
import { createTestClock } from "@/shared/time";
import { callRoute } from "@/tests/setup/callRoute";
import { createSystemController } from "../system.controller";
import { createSystemService } from "../system.service";

afterAll(() => getPrisma().$disconnect());

describe("GET /api/health", () => {
  it("returns 200 with status ok and the database up, against the test database", async () => {
    const result = await callRoute(GET, { path: "/api/health" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: {
        status: "ok",
        database: "up",
        version: expect.any(String),
        time: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
      },
    });
  });

  it("returns 503 with the database down when the database check fails", async () => {
    const service = createSystemService({
      repository: { pingDatabase: () => Promise.reject(new Error("connection refused")) },
      clock: createTestClock("2027-01-01T00:00:00.000Z"),
      version: "test",
      logger: { warn: vi.fn() },
    });
    const handler = route({ access: "public", handler: createSystemController(service).health });

    const result = await callRoute(handler, { path: "/api/health" });

    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      data: {
        status: "degraded",
        database: "down",
        version: "test",
        time: "2027-01-01T00:00:00.000Z",
      },
    });
  });
});
