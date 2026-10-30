import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@/modules/identity");
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

const withCookie = (cookie?: string) => ({ headers: new Headers(cookie ? { cookie } : {}) });
const fakePrincipal = (role: string) => ({
  userId: "u",
  roleCode: role,
  bypassesAccess: false,
  permissions: new Set<never>(),
});

describe("test role cookie resolver", () => {
  it("builds the principal for the role named in the eh_test_role cookie", async () => {
    stubEnv("test");
    const { createTestRoleCookieResolver, TEST_ROLE_COOKIE } = await import("../testRoleCookie");
    const loader = vi.fn(async (role: string) => fakePrincipal(role));
    const resolve = createTestRoleCookieResolver(loader);

    await expect(resolve(withCookie(`a=1; ${TEST_ROLE_COOKIE}=MANAGER`))).resolves.toMatchObject({
      roleCode: "MANAGER",
    });
    await expect(resolve(withCookie())).resolves.toBeNull();
    await expect(resolve(withCookie(`${TEST_ROLE_COOKIE}=not%20a%20role`))).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("resolves nobody when the role does not exist", async () => {
    stubEnv("test");
    const { createTestRoleCookieResolver, TEST_ROLE_COOKIE } = await import("../testRoleCookie");
    const resolve = createTestRoleCookieResolver(async () => {
      throw new Error("no such role");
    });
    await expect(resolve(withCookie(`${TEST_ROLE_COOKIE}=GHOST`))).resolves.toBeNull();
  });

  it("cannot be installed outside APP_ENV=test", async () => {
    stubEnv("development");
    const { installTestRoleCookieResolver } = await import("../testRoleCookie");
    expect(() => installTestRoleCookieResolver(async (role) => fakePrincipal(role))).toThrow(
      /APP_ENV=test/,
    );
  });
});

describe("instrumentation register()", () => {
  const sessionPrincipal = fakePrincipal("FROM_SESSION");

  async function registerAndResolve(appEnv: "test" | "development", cookie = "eh_test_role=ADMIN") {
    stubEnv(appEnv);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.doMock("@/modules/identity", () => ({
      buildPrincipalForRole: async (role: string) => fakePrincipal(role),
      createSessionPrincipalResolver:
        () =>
        async ({ headers }: { headers: Headers }) =>
          headers.get("cookie")?.includes("eh_session=") ? sessionPrincipal : null,
    }));
    const { register } = await import("@/instrumentation");
    await register();
    const { resolvePrincipal } = await import("../principalResolver");
    return resolvePrincipal(withCookie(cookie));
  }

  it("installs the test role cookie resolver when APP_ENV=test", async () => {
    await expect(registerAndResolve("test")).resolves.toMatchObject({ roleCode: "ADMIN" });
  });

  it("falls through to the session resolver when APP_ENV=test and there is no test cookie", async () => {
    await expect(registerAndResolve("test", "eh_session=abc")).resolves.toBe(sessionPrincipal);
  });

  it("uses the session resolver in every other environment", async () => {
    await expect(registerAndResolve("development", "eh_session=abc")).resolves.toBe(
      sessionPrincipal,
    );
  });

  it("fails at startup when the storage driver is not available", async () => {
    stubEnv("development");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("STORAGE_DRIVER", "s3");
    for (const name of ["ENDPOINT", "REGION", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"]) {
      vi.stubEnv(`STORAGE_S3_${name}`, name === "ENDPOINT" ? "https://s3.example.com" : "x");
    }
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow(/Phase 7/);
  });

  it("ignores the test cookie outside APP_ENV=test", async () => {
    await expect(registerAndResolve("development")).resolves.toBeNull();
  });
});
