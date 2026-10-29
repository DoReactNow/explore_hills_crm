// db:sync-rbac rules (Decision 23).
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { DEFAULT_ROLES } from "@/shared/rbac/defaultRoles";
import { PERMISSIONS } from "@/shared/rbac/permissionRegistry";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { syncRbac } from "..";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(() => client.connect());
beforeEach(() => resetDatabase());
afterAll(async () => {
  await resetDatabase();
  await client.end();
  await getPrisma().$disconnect();
});

async function snapshot() {
  const permissions = await client.query(
    `SELECT id, code, label, description, module, "isReserved" FROM identity_permissions ORDER BY code`,
  );
  const roles = await client.query(
    `SELECT id, code, name, description, "isSystem", "bypassesAccess" FROM identity_roles ORDER BY code`,
  );
  const grants = await client.query(
    `SELECT r.code AS role, p.code AS permission FROM identity_role_permissions rp
     JOIN identity_roles r ON r.id = rp."roleId" JOIN identity_permissions p ON p.id = rp."permissionId"
     ORDER BY 1, 2`,
  );
  return { permissions: permissions.rows, roles: roles.rows, grants: grants.rows };
}

const grantsOf = async (role: string) =>
  (await snapshot()).grants.filter((g) => g.role === role).map((g) => g.permission);

const PROBE = {
  label: "Probe",
  description: "A permission that exists only in this test",
  module: "system",
  reserved: false,
};

describe("syncRbac", () => {
  it("creates every registry permission and the four system roles with their default bundles", async () => {
    await syncRbac();
    const state = await snapshot();
    expect(state.permissions.map((p) => p.code)).toEqual(Object.keys(PERMISSIONS).sort());
    expect(state.permissions.find((p) => p.code === "roles:manage")?.isReserved).toBe(true);
    expect(state.roles.map((r) => r.code)).toEqual(["ADMIN", "AGENT", "MANAGER", "SUPER_ADMIN"]);
    expect(state.roles.every((r) => r.isSystem)).toBe(true);
    expect(state.roles.filter((r) => r.bypassesAccess).map((r) => r.code)).toEqual(["SUPER_ADMIN"]);
    expect(await grantsOf("ADMIN")).toEqual([...DEFAULT_ROLES.ADMIN.permissions].sort());
    expect(await grantsOf("SUPER_ADMIN")).toEqual([]);
  });

  it("is idempotent: a second run changes nothing, IDs included", async () => {
    await syncRbac();
    const first = await snapshot();
    await syncRbac();
    expect(await snapshot()).toEqual(first);
  });

  it("grants a NEW registry permission to the roles whose defaults list it", async () => {
    await syncRbac();
    await syncRbac({
      permissions: { ...PERMISSIONS, "probe:new": PROBE },
      roles: {
        ...DEFAULT_ROLES,
        ADMIN: {
          ...DEFAULT_ROLES.ADMIN,
          permissions: [...DEFAULT_ROLES.ADMIN.permissions, "probe:new"],
        },
      },
    });
    expect(await grantsOf("ADMIN")).toContain("probe:new");
    expect(await grantsOf("MANAGER")).not.toContain("probe:new");
  });

  it("deletes a permission removed from the registry, together with its grants", async () => {
    const withProbe = {
      permissions: { ...PERMISSIONS, "probe:old": PROBE },
      roles: {
        ...DEFAULT_ROLES,
        ADMIN: {
          ...DEFAULT_ROLES.ADMIN,
          permissions: [...DEFAULT_ROLES.ADMIN.permissions, "probe:old"],
        },
      },
    };
    await syncRbac(withProbe);
    expect(await grantsOf("ADMIN")).toContain("probe:old");

    await syncRbac();
    const state = await snapshot();
    expect(state.permissions.map((p) => p.code)).not.toContain("probe:old");
    expect(state.grants.map((g) => g.permission)).not.toContain("probe:old");
  });

  it("keeps a grant that was removed by hand removed after re-sync", async () => {
    await syncRbac();
    await client.query(
      `DELETE FROM identity_role_permissions WHERE "roleId" = (SELECT id FROM identity_roles WHERE code = 'ADMIN')
       AND "permissionId" = (SELECT id FROM identity_permissions WHERE code = 'system:view-diagnostics')`,
    );
    await syncRbac();
    expect(await grantsOf("ADMIN")).not.toContain("system:view-diagnostics");
  });

  it("keeps a grant that was added by hand", async () => {
    await syncRbac();
    await client.query(
      `INSERT INTO identity_role_permissions ("roleId", "permissionId")
       SELECT r.id, p.id FROM identity_roles r, identity_permissions p
       WHERE r.code = 'MANAGER' AND p.code = 'system:view-diagnostics'`,
    );
    await syncRbac();
    expect(await grantsOf("MANAGER")).toContain("system:view-diagnostics");
  });

  it("creates SUPER_ADMIN if missing and never updates it", async () => {
    await syncRbac();
    await client.query(
      `UPDATE identity_roles SET name = 'Owner', description = 'Edited' WHERE code = 'SUPER_ADMIN'`,
    );
    await syncRbac();
    const superAdmin = (await snapshot()).roles.find((r) => r.code === "SUPER_ADMIN");
    expect(superAdmin).toMatchObject({
      name: "Owner",
      description: "Edited",
      bypassesAccess: true,
    });
  });

  it("refuses a registry or role bundle that would grant a reserved permission", async () => {
    await expect(
      syncRbac({
        roles: {
          ...DEFAULT_ROLES,
          ADMIN: { ...DEFAULT_ROLES.ADMIN, permissions: ["roles:manage"] },
        },
      }),
    ).rejects.toThrow(/reserved/i);
  });
});
