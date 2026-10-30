import { describe, expect, it } from "vitest";
import { AppError } from "../AppError";
import { ERROR_CATALOG, ERROR_CODES, NETWORK_ERROR_MESSAGE } from "../errorCatalog";

const EXPECTED_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_CREDENTIALS: 401,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const;

describe("error catalog", () => {
  it("has exactly the expected codes", () => {
    expect([...ERROR_CODES].sort()).toEqual(Object.keys(EXPECTED_STATUS).sort());
  });

  it.each(Object.entries(EXPECTED_STATUS))(
    "AppError(%s) maps to its message and status %i",
    (code, status) => {
      const error = new AppError(code as keyof typeof EXPECTED_STATUS);
      expect(error.status).toBe(status);
      expect(error.publicMessage).toBe(ERROR_CATALOG[code as keyof typeof EXPECTED_STATUS].message);
      expect(error.publicMessage.length).toBeGreaterThan(10);
    },
  );

  it("uses the agreed wording for FORBIDDEN (Decision 5)", () => {
    expect(ERROR_CATALOG.FORBIDDEN.message).toBe("You don't have access to do this.");
  });

  it("contains no permission-shaped codes or technical words", () => {
    const messages = [
      ...Object.values(ERROR_CATALOG).map((entry) => entry.message),
      NETWORK_ERROR_MESSAGE,
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/\b[a-z]+(-[a-z]+)*:[a-z]+(-[a-z]+)*\b/);
      expect(message).not.toMatch(/prisma|sql|stack|undefined|ECONN|null|exception/i);
    }
  });
});
