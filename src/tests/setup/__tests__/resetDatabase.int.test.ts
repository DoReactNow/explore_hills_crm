import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";
import { resetDatabase } from "../resetDatabase";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(() => client.connect());
afterAll(() => client.end());

const count = async (table: string) =>
  Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);

describe("resetDatabase", () => {
  it("empties every application table but keeps the migration history", async () => {
    await client.query(
      `INSERT INTO system_worker_heartbeats ("workerId", version, "startedAt", "lastBeatAt")
       VALUES ('test-worker', 'v', now(), now())`,
    );
    await client.query(
      `INSERT INTO identity_roles (id, code, name, "updatedAt")
       VALUES (gen_random_uuid(), 'RESET_PROBE', 'Probe', now())`,
    );
    expect(await count("system_worker_heartbeats")).toBe(1);

    await resetDatabase();

    expect(await count("system_worker_heartbeats")).toBe(0);
    expect(await count("identity_roles")).toBe(0);
    expect(await count("_prisma_migrations")).toBeGreaterThan(0);
  });

  it("refuses a database whose name does not end in _test, before connecting", async () => {
    await expect(
      resetDatabase({ connectionString: "postgresql://u:p@127.0.0.1:1/explorehills_dev" }),
    ).rejects.toThrow(/refusing to run/i);
  });
});
