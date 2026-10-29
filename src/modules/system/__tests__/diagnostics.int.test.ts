import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/diagnostics/route";
import { syncRbac } from "@/modules/identity";
import { getPrisma } from "@/shared/db/prisma";
import { ERROR_CATALOG } from "@/shared/errors/errorCatalog";
import * as loggerModule from "@/shared/logger";
import { PERMISSION_CODES } from "@/shared/rbac/permissionRegistry";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";

beforeAll(async () => {
  await resetDatabase();
  await syncRbac();
});
afterEach(() => {
  stopActing();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await resetDatabase();
  await getPrisma().$disconnect();
});

describe("GET /api/diagnostics (system:view-diagnostics)", () => {
  it.each(["ADMIN", "SUPER_ADMIN"])("returns 200 for %s", async (role) => {
    actAs(await testPrincipal(role));
    const result = await callRoute(GET, { path: "/api/diagnostics" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ data: { database: "up" } });
  });

  it.each(["MANAGER", "AGENT"])(
    "returns 403 with the generic message and no permission code for %s",
    async (role) => {
      actAs(await testPrincipal(role));
      const result = await callRoute(GET, { path: "/api/diagnostics" });
      expect(result.status).toBe(403);
      expect(result.body).toEqual({
        error: {
          code: "FORBIDDEN",
          message: ERROR_CATALOG.FORBIDDEN.message,
          requestId: expect.any(String),
        },
      });
      const text = JSON.stringify(result.body);
      for (const code of PERMISSION_CODES) expect(text).not.toContain(code);
    },
  );

  it("returns 401 without a principal", async () => {
    actAs(null);
    const result = await callRoute(GET, { path: "/api/diagnostics" });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("writes the permission code and principal ID to the server log on a denial", async () => {
    const manager = await testPrincipal("MANAGER");
    actAs(manager);
    const warn = vi.fn();
    const silent = () => undefined;
    const fake = { trace: silent, debug: silent, info: silent, warn, error: silent, fatal: silent };
    vi.spyOn(loggerModule.logger, "child").mockReturnValue({
      ...fake,
      child: () => ({ ...fake, child: vi.fn() }),
    });

    await callRoute(GET, { path: "/api/diagnostics" });

    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        permission: "system:view-diagnostics",
        principalId: manager.userId,
      }),
    );
  });
});
