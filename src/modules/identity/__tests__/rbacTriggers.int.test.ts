// The database itself refuses reserved grants and grants to the bypass role (Decision 23).
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { syncRbac } from "..";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(async () => {
  await client.connect();
  await resetDatabase();
  await syncRbac();
});
afterAll(async () => {
  await resetDatabase();
  await client.end();
  await getPrisma().$disconnect();
});

const grant = (role: string, permission: string) =>
  client.query(
    `INSERT INTO identity_role_permissions ("roleId", "permissionId")
     SELECT r.id, p.id FROM identity_roles r, identity_permissions p WHERE r.code = $1 AND p.code = $2`,
    [role, permission],
  );

describe("RBAC database triggers", () => {
  it.each(["ADMIN", "MANAGER", "AGENT"])(
    "rejects granting a reserved permission to %s",
    async (role) => {
      await expect(grant(role, "roles:manage")).rejects.toThrow(
        /reserved permissions cannot be granted/,
      );
      await expect(grant(role, "users:manage-super-admins")).rejects.toThrow(
        /reserved permissions cannot be granted/,
      );
    },
  );

  it("rejects any grant to the bypass role", async () => {
    await expect(grant("SUPER_ADMIN", "system:view-diagnostics")).rejects.toThrow(
      /bypass role cannot hold grants/,
    );
  });

  it("rejects deleting or renaming SUPER_ADMIN and deleting a system role", async () => {
    await expect(
      client.query(`DELETE FROM identity_roles WHERE code = 'SUPER_ADMIN'`),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      client.query(`UPDATE identity_roles SET code = 'X' WHERE code = 'SUPER_ADMIN'`),
    ).rejects.toThrow(/cannot change/);
    await expect(client.query(`DELETE FROM identity_roles WHERE code = 'AGENT'`)).rejects.toThrow(
      /cannot be deleted/,
    );
  });
});
