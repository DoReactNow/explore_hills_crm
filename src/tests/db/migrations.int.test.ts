// W-007: the baseline migration creates the Phase 0 tables and is recorded by Prisma.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";

const client = new Client({ connectionString: getEnv().DATABASE_URL });

beforeAll(() => client.connect());
afterAll(() => client.end());

describe("migrations", () => {
  it("creates the application tables in the public schema", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "_prisma_migrations",
      "audit_events",
      "identity_login_throttle",
      "identity_permissions",
      "identity_role_permissions",
      "identity_roles",
      "identity_sessions",
      "identity_team_members",
      "identity_teams",
      "identity_users",
      "leads_contacts",
      "leads_leads",
      "leads_notes",
      "leads_pipeline_stages",
      "leads_tasks",
      "leads_timeline_entries",
      "messaging_conversations",
      "messaging_messages",
      "messaging_templates",
      "messaging_webhook_events",
      "system_settings",
      "system_worker_heartbeats",
    ]);
  });

  it("records every migration as applied, baseline first", async () => {
    const { rows } = await client.query<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`,
    );
    expect(rows[0].migration_name).toMatch(/^\d{14}_init_identity_rbac_system$/);
    expect(rows.map((row) => row.migration_name.slice(15))).toContain(
      "identity_users_sessions_audit",
    );
    expect(rows.every((row) => row.finished_at !== null)).toBe(true);
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
