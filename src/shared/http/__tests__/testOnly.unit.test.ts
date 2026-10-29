import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(appEnv: "test" | "development" | "production") {
  const production = appEnv === "production";
  const database = {
    test: "explorehills_test",
    development: "explorehills_dev",
    production: "explorehills",
  }[appEnv];
  vi.stubEnv("APP_ENV", appEnv);
  vi.stubEnv("APP_HOST", "127.0.0.1");
  vi.stubEnv("APP_PORT", "47215");
  vi.stubEnv("APP_URL", "http://127.0.0.1:47215");
  vi.stubEnv("DATABASE_URL", `postgresql://u:p@127.0.0.1:54329/${database}`);
  vi.stubEnv("AUTH_SECRET", "x".repeat(40));
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  vi.stubEnv("TELEPHONY_PROVIDER", production ? "someprovider" : "fake");
  vi.stubEnv("WHATSAPP_GATEWAY", production ? "somegateway" : "fake");
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("STORAGE_LOCAL_DIR", "./storage/test");
  return import("../testOnly");
}

describe("test-only features", () => {
  it("are enabled only when APP_ENV=test", async () => {
    expect((await load("test")).isTestEnvironment()).toBe(true);
  });

  it.each(["development", "production"] as const)(
    "are unreachable when APP_ENV=%s (404 NOT_FOUND)",
    async (appEnv) => {
      const { assertTestEnvironment, isTestEnvironment } = await load(appEnv);
      expect(isTestEnvironment()).toBe(false);
      expect(() => assertTestEnvironment()).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    },
  );
});
