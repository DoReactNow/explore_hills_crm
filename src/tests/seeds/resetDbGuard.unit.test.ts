// W-112: db:reset can only reset the database that matches its env file (P0-OPS-02).
import { describe, expect, it } from "vitest";
import { assertResetTarget } from "../../../scripts/resetDbGuard";

describe("db:reset guard", () => {
  it("accepts .env with a development database", () => {
    expect(() =>
      assertResetTarget(".env", { APP_ENV: "development", databaseName: "explorehills_dev" }),
    ).not.toThrow();
  });

  it("accepts .env.test with a _test database", () => {
    expect(() =>
      assertResetTarget(".env.test", { APP_ENV: "test", databaseName: "explorehills_test" }),
    ).not.toThrow();
  });

  it("refuses production, whichever file names it", () => {
    for (const file of [".env", ".env.test", ".env.production"]) {
      expect(() =>
        assertResetTarget(file, { APP_ENV: "production", databaseName: "explorehills" }),
      ).toThrow(/refusing/i);
    }
  });

  it("refuses a mismatch between the file and its settings", () => {
    expect(() =>
      assertResetTarget(".env", { APP_ENV: "test", databaseName: "explorehills_test" }),
    ).toThrow(/refusing/i);
    expect(() =>
      assertResetTarget(".env", { APP_ENV: "development", databaseName: "explorehills_test" }),
    ).toThrow(/refusing/i);
    expect(() =>
      assertResetTarget(".env.test", { APP_ENV: "development", databaseName: "explorehills_dev" }),
    ).toThrow(/refusing/i);
  });

  it("refuses any other env file", () => {
    expect(() =>
      assertResetTarget(".env.staging", { APP_ENV: "development", databaseName: "x" }),
    ).toThrow(/refusing/i);
  });
});
