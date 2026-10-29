import { describe, expect, it } from "vitest";
import { assertRealSeedTarget, checkSuperAdminCredentials } from "@seeds/realSeed";
import { assertTestSeedTarget } from "@seeds/testSeed";

describe("test seed target", () => {
  it("runs only with APP_ENV=test on a database ending in _test", () => {
    expect(() =>
      assertTestSeedTarget({ APP_ENV: "test", databaseName: "explorehills_test" }),
    ).not.toThrow();
    expect(() =>
      assertTestSeedTarget({ APP_ENV: "test", databaseName: "explorehills_dev" }),
    ).toThrow(/refusing to run/i);
    expect(() =>
      assertTestSeedTarget({ APP_ENV: "development", databaseName: "explorehills_test" }),
    ).toThrow(/refusing to run/i);
  });
});

describe("real seed target", () => {
  it("refuses a test database or APP_ENV=test", () => {
    expect(() =>
      assertRealSeedTarget({ APP_ENV: "development", databaseName: "explorehills_dev" }),
    ).not.toThrow();
    expect(() =>
      assertRealSeedTarget({ APP_ENV: "production", databaseName: "explorehills" }),
    ).not.toThrow();
    expect(() =>
      assertRealSeedTarget({ APP_ENV: "development", databaseName: "explorehills_test" }),
    ).toThrow(/refusing to run/i);
    expect(() =>
      assertRealSeedTarget({ APP_ENV: "test", databaseName: "explorehills_dev" }),
    ).toThrow(/refusing to run/i);
  });

  it("refuses a missing, placeholder or weak Super Admin password", () => {
    const email = "owner@example.com";
    for (const password of [
      undefined,
      "",
      "change-me-before-seeding",
      "short1A!",
      "alllowercaseletters",
      "Password1234",
    ]) {
      expect(() => checkSuperAdminCredentials({ email, password }), String(password)).toThrow(
        /SEED_SUPER_ADMIN_PASSWORD/,
      );
    }
  });

  it("refuses a missing or malformed Super Admin email", () => {
    const password = "Correct-Horse-Battery-9";
    expect(() => checkSuperAdminCredentials({ email: undefined, password })).toThrow(
      /SEED_SUPER_ADMIN_EMAIL/,
    );
    expect(() => checkSuperAdminCredentials({ email: "not-an-email", password })).toThrow(
      /SEED_SUPER_ADMIN_EMAIL/,
    );
  });

  it("accepts a strong password and normalises the email to lowercase", () => {
    expect(
      checkSuperAdminCredentials({
        email: " Owner@Example.com ",
        password: "Correct-Horse-Battery-9",
      }),
    ).toEqual({
      email: "owner@example.com",
      password: "Correct-Horse-Battery-9",
    });
  });

  it("never puts the password in an error message", () => {
    const password = "weakpass";
    try {
      checkSuperAdminCredentials({ email: "a@b.co", password });
    } catch (error) {
      expect(String(error)).not.toContain(password);
    }
  });
});
