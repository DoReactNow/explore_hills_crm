import { describe, expect, it } from "vitest";
import { ERROR_CATALOG } from "@/shared/errors/errorCatalog";
import { callRoute } from "@/tests/setup/callRoute";
import { GET } from "../route";

describe("GET /api/test-support/fail (test-only)", () => {
  it("returns 500 INTERNAL_ERROR with the generic message and no internal detail", async () => {
    const result = await callRoute(GET, { path: "/api/test-support/fail" });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: ERROR_CATALOG.INTERNAL_ERROR.message,
        requestId: result.headers.get("x-request-id"),
      },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/stack|at |deliberate|Error:/i);
  });
});
