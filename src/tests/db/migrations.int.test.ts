// W-007: the baseline migration creates the Phase 0 tables and is recorded by Prisma.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";

const client = new Client({ connectionString: getEnv().DATABASE_URL });

beforeAll(() => client.connect());
afterAll(() => client.end());

describe("baseline migration", () => {
  it("creates the Phase 0 tables in the public schema", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "_prisma_migrations",
      "identity_permissions",
      "identity_role_permissions",
      "identity_roles",
      "system_worker_heartbeats",
    ]);
  });

  it("records the baseline migration as applied", async () => {
    const { rows } = await client.query<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].migration_name).toMatch(/^\d{14}_init_identity_rbac_system$/);
    expect(rows[0].finished_at).not.toBeNull();
  });

  it("stores instants as timestamptz(3)", async () => {
    const { rows } = await client.query<{
      column_name: string;
      data_type: string;
      precision: number;
    }>(
      `SELECT column_name, data_type, datetime_precision AS precision
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'system_worker_heartbeats'
         AND column_name IN ('startedAt', 'lastBeatAt')
       ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: "lastBeatAt", data_type: "timestamp with time zone", precision: 3 },
      { column_name: "startedAt", data_type: "timestamp with time zone", precision: 3 },
    ]);
  });
});
