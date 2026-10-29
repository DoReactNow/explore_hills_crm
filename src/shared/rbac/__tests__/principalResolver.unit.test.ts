import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).explorehillsPrincipalResolver;
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
const fake = (role: string) => ({
  userId: "u",
  roleCode: role,
  bypassesAccess: false,
  permissions: new Set<never>(),
});

describe("principal resolver", () => {
  it("resolves no principal by default (Phase 0 has no sign-in)", async () => {
    stubEnv("development");
    const { resolvePrincipal } = await import("../principalResolver");
    await expect(resolvePrincipal(request)).resolves.toBeNull();
  });

  it("uses the resolver configured by the composition root", async () => {
    stubEnv("development");
    const mod = await import("../principalResolver");
    mod.configurePrincipalResolver(async () => fake("AGENT"));
    await expect(mod.resolvePrincipal(request)).resolves.toMatchObject({ roleCode: "AGENT" });
  });

  it("lets a test override win, only when APP_ENV=test, and restores on null", async () => {
    stubEnv("test");
    const mod = await import("../principalResolver");
    mod.configurePrincipalResolver(async () => fake("AGENT"));
    mod.setPrincipalResolverForTests(async () => fake("ADMIN"));
    await expect(mod.resolvePrincipal(request)).resolves.toMatchObject({ roleCode: "ADMIN" });
    mod.setPrincipalResolverForTests(null);
    await expect(mod.resolvePrincipal(request)).resolves.toMatchObject({ roleCode: "AGENT" });
  });

  it("refuses the test override outside APP_ENV=test", async () => {
    stubEnv("development");
    const { setPrincipalResolverForTests } = await import("../principalResolver");
    expect(() => setPrincipalResolverForTests(async () => null)).toThrow(/APP_ENV=test/);
  });
});
