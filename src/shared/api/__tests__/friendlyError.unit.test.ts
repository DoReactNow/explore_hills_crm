import { describe, expect, it } from "vitest";
import { ERROR_CATALOG, NETWORK_ERROR_MESSAGE } from "@/shared/errors/errorCatalog";
import { toFriendlyError } from "../friendlyError";

const rid = "11111111-2222-4333-8444-555555555555";

describe("frontend friendly error mapper", () => {
  it("maps a network failure to a fixed sentence", () => {
    expect(toFriendlyError({ networkError: true })).toMatchObject({
      code: "NETWORK_ERROR",
      message: NETWORK_ERROR_MESSAGE,
    });
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "INTERNAL_ERROR"],
    [502, "INTERNAL_ERROR"],
    [503, "UPSTREAM_UNAVAILABLE"],
    [418, "INTERNAL_ERROR"],
  ] as const)("maps status %i with a malformed body to %s", (status, code) => {
    for (const body of [
      undefined,
      "<html>Bad Gateway</html>",
      { nope: true },
      { error: "Expected string" },
    ]) {
      expect(toFriendlyError({ status, body })).toMatchObject({
        code,
        message: ERROR_CATALOG[code].message,
      });
    }
  });

  it("uses the catalog message for a known code and ignores the server's message text", () => {
    const result = toFriendlyError({
      status: 409,
      body: {
        error: {
          code: "CONFLICT",
          message: "duplicate key value violates unique constraint",
          requestId: rid,
        },
      },
    });
    expect(result).toEqual({
      code: "CONFLICT",
      message: ERROR_CATALOG.CONFLICT.message,
      requestId: rid,
    });
  });

  it("falls back to the status when the body names an unknown code", () => {
    const result = toFriendlyError({
      status: 403,
      body: { error: { code: "leads:assign", message: "missing leads:assign" } },
    });
    expect(result.message).toBe(ERROR_CATALOG.FORBIDDEN.message);
    expect(JSON.stringify(result)).not.toContain("leads:assign");
  });

  it("keeps validation field messages and drops malformed field entries and bad request IDs", () => {
    const result = toFriendlyError({
      status: 400,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "x",
          requestId: "not a uuid <script>",
          fieldErrors: [
            { field: "email", message: "Enter a valid email address." },
            { field: 3 },
            "junk",
          ],
        },
      },
    });
    expect(result).toEqual({
      code: "VALIDATION_FAILED",
      message: ERROR_CATALOG.VALIDATION_FAILED.message,
      fieldErrors: [{ field: "email", message: "Enter a valid email address." }],
    });
  });

  it("keeps the specific reason on a CONFLICT, so a refusal can explain itself", () => {
    const error = toFriendlyError({
      status: 409,
      body: {
        error: {
          code: "CONFLICT",
          message: "x",
          requestId: "r",
          fieldErrors: [{ field: "_root", message: "Move this team's members first." }],
        },
      },
    });
    expect(error.fieldErrors?.[0].message).toBe("Move this team's members first.");
  });
});
