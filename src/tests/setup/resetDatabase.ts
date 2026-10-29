// Empties every application table in the test database (the migration history stays).
import { Client } from "pg";
import { getEnv } from "@/shared/config/env";
import { assertTestDatabaseUrl } from "./guards";

// pg-boss 12 job tables (confirmed in W-012). Queue definitions ("queue") are kept, because a
// running pg-boss instance caches them.
const PGBOSS_JOB_TABLES = ["job", "job_dependency"];

export async function resetDatabase(options: { connectionString?: string } = {}): Promise<void> {
  const connectionString = options.connectionString ?? getEnv().DATABASE_URL;
  assertTestDatabaseUrl(connectionString);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS name
       FROM pg_tables
       WHERE (schemaname = 'public' AND tablename <> '_prisma_migrations')
          OR (schemaname = 'pgboss' AND tablename = ANY($1))`,
      [PGBOSS_JOB_TABLES],
    );
    if (rows.length > 0) {
      // TRUNCATE skips row-level DELETE triggers, so protected system rows are cleared too.
      await client.query(
        `TRUNCATE ${rows.map((row) => row.name).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
  } finally {
    await client.end();
  }
}
