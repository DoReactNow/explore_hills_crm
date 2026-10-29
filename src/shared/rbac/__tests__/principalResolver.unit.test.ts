import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function stubEnv(appEnv: "test" | "development") {
  vi.stubEnv("APP_ENV", appEnv);
  vi.stubEnv("APP_HOST", "127.0.0.1");
  vi.stubEnv("APP_PORT", "47215");
  vi.stubEnv("APP_URL", "http://127.0.0.1:47215");
  vi.stubEnv(
    "DATABASE_URL",
    `postgresql://u:p@127.0.0.1:54329/explorehills_${appEnv === "test" ? "test" : "dev"}`,
  );
  vi.stubEnv("AUTH_SECRET", "x".repeat(40));
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  vi.stubEnv("TELEPHONY_PROVIDER", "fake");
  vi.stubEnv("WHATSAPP_GATEWAY", "fake");
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("STORAGE_LOCAL_DIR", "./storage/test");
}

const request = new Request("http://127.0.0.1/api/x");

describe("principal resolver", () => {
  it("resolves no principal by default (Phase 0 has no sign-in)", async () => {
    stubEnv("development");
    const { resolvePrincipal } = await import("../principalResolver");
    await expect(resolvePrincipal(request)).resolves.toBeNull();
  });

  it("accepts a test override only when APP_ENV=test", async () => {
    stubEnv("test");
    const mod = await import("../principalResolver");
    const fake = {
      userId: "u",
      roleCode: "ADMIN",
      bypassesAccess: false,
      permissions: new Set<never>(),
    };
    mod.setPrincipalResolverForTests(async () => fake);
    await expect(mod.resolvePrincipal(request)).resolves.toBe(fake);
    mod.setPrincipalResolverForTests(null);
    await expect(mod.resolvePrincipal(request)).resolves.toBeNull();
  });

  it("refuses the test override outside APP_ENV=test", async () => {
    stubEnv("development");
    const { setPrincipalResolverForTests } = await import("../principalResolver");
    expect(() => setPrincipalResolverForTests(async () => null)).toThrow(/APP_ENV=test/);
  });
});
