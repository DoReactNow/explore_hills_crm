import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTestSeed } from "@seeds/testSeed";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { resetDatabase } from "@/tests/setup/resetDatabase";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(async () => {
  await client.connect();
  await resetDatabase();
});
afterAll(async () => {
  await resetDatabase();
  await client.end();
  await getPrisma().$disconnect();
});

async function snapshot() {
  const tables = [
    "identity_permissions",
    "identity_roles",
    "identity_role_permissions",
    "system_worker_heartbeats",
  ];
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    result[table] = (await client.query(`SELECT * FROM ${table} ORDER BY 1, 2`)).rows.map((row) => {
      // Timestamps change on every write; compare everything else.
      const rest = { ...(row as Record<string, unknown>) };
      delete rest.createdAt;
      delete rest.updatedAt;
      return rest;
    });
  }
  return result;
}

describe("test seed", () => {
  it("seeds the RBAC data and produces identical data when run twice", async () => {
    await runTestSeed();
    const first = await snapshot();
    expect((first.identity_roles as Array<{ code: string }>).map((r) => r.code).sort()).toEqual([
      "ADMIN",
      "AGENT",
      "MANAGER",
      "SUPER_ADMIN",
      "TEAM_VIEWER",
    ]);

    await runTestSeed();
    expect(await snapshot()).toEqual(first);
  });
});
