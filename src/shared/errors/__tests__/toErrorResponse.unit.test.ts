import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "../AppError";
import { ERROR_CATALOG, GENERIC_FIELD_MESSAGE } from "../errorCatalog";
import { parseInput, toErrorResponse } from "../toErrorResponse";

const requestId = "11111111-2222-4333-8444-555555555555";
const logger = () => ({ warn: vi.fn(), error: vi.fn() });

describe("toErrorResponse", () => {
  it("returns the catalog message and status for an AppError", () => {
    const log = logger();
    const result = toErrorResponse(new AppError("CONFLICT"), { requestId, logger: log });
    expect(result).toEqual({
      status: 409,
      body: { error: { code: "CONFLICT", message: ERROR_CATALOG.CONFLICT.message, requestId } },
    });
  });

  it.each([
    ["a thrown Error", new Error("connect ECONNREFUSED 127.0.0.1:5432")],
    [
      "a Prisma-like error",
      Object.assign(new Error("Invalid `prisma.user.create()` invocation"), { code: "P2002" }),
    ],
    ["a string", "something broke"],
  ])("turns %s into INTERNAL_ERROR and logs the original with the requestId", (_label, thrown) => {
    const log = logger();
    const result = toErrorResponse(thrown, { requestId, logger: log });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: ERROR_CATALOG.INTERNAL_ERROR.message, requestId },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/ECONN|prisma|broke|P2002/);
    expect(log.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ requestId, err: thrown }),
    );
  });

  it("logs an INTERNAL_ERROR AppError's cause but never returns it", () => {
    const log = logger();
    const cause = new Error("disk full");
    const result = toErrorResponse(new AppError("INTERNAL_ERROR", { cause }), {
      requestId,
      logger: log,
    });
    expect(JSON.stringify(result.body)).not.toContain("disk full");
    expect(log.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ err: cause }),
    );
  });
});

describe("parseInput (Zod validation)", () => {
  const schema = z.object({
    email: z.email({ error: "Enter a valid email address." }),
    count: z.number().int(),
  });

  it("returns the parsed data when valid", () => {
    expect(parseInput(schema, { email: "a@b.co", count: 2 })).toEqual({
      email: "a@b.co",
      count: 2,
    });
  });

  it("throws VALIDATION_FAILED with friendly per-field messages and no library text", () => {
    let caught: unknown;
    try {
      parseInput(schema, { email: "nope", count: "x" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    const error = caught as AppError;
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.fieldErrors).toEqual([
      { field: "email", message: "Enter a valid email address." },
      { field: "count", message: GENERIC_FIELD_MESSAGE },
    ]);
    const body = JSON.stringify(toErrorResponse(error, { requestId, logger: logger() }).body);
    expect(body).not.toMatch(/expected|received|invalid input|NaN/i);
    expect(body).toContain('"fieldErrors"');
  });

  it("names nested fields with dots and the whole input as _root", () => {
    const nested = z.object({ trip: z.object({ people: z.number() }) });
    try {
      parseInput(nested, { trip: { people: "four" } });
    } catch (error) {
      expect((error as AppError).fieldErrors).toEqual([
        { field: "trip.people", message: GENERIC_FIELD_MESSAGE },
      ]);
    }
    try {
      parseInput(nested, "not an object");
    } catch (error) {
      expect((error as AppError).fieldErrors).toEqual([
        { field: "_root", message: GENERIC_FIELD_MESSAGE },
      ]);
    }
  });
});
