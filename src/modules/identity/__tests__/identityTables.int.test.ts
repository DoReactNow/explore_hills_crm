// W-101: users, sessions, sign-in throttle and the audit trail, with the rules Prisma cannot express.
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { syncRbac } from "..";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(() => client.connect());
beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
});
afterAll(async () => {
  await resetDatabase();
  await client.end();
  await getPrisma().$disconnect();
});

async function insertUser(email: string, phoneE164: string | null = null, roleCode = "AGENT") {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO identity_users (id, email, name, "phoneE164", "passwordHash", status, "roleId", "updatedAt")
     SELECT gen_random_uuid(), $1, 'Test User', $2, 'hash', 'ACTIVE', id, now() FROM identity_roles WHERE code = $3
     RETURNING id`,
    [email, phoneE164, roleCode],
  );
  return rows[0].id;
}

describe("identity and audit tables", () => {
  it("exist, with every instant stored as timestamptz(3)", async () => {
    const { rows } = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      p: number;
    }>(
      `SELECT table_name, column_name, data_type, datetime_precision AS p FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('identity_users', 'identity_sessions', 'identity_login_throttle', 'audit_events')
         AND data_type LIKE 'timestamp%'`,
    );
    expect(new Set(rows.map((row) => row.table_name))).toEqual(
      new Set(["identity_users", "identity_sessions", "identity_login_throttle", "audit_events"]),
    );
    for (const row of rows) {
      expect(`${row.table_name}.${row.column_name} ${row.data_type}(${row.p})`).toBe(
        `${row.table_name}.${row.column_name} timestamp with time zone(3)`,
      );
    }
  });

  it("rejects a second user whose email differs only in case", async () => {
    await insertUser("riya.agent@example.com");
    await expect(insertUser("Riya.Agent@Example.com")).rejects.toThrow(
      /identity_users_email_lower_key/,
    );
  });

  it("accepts an E.164 phone number and rejects anything else", async () => {
    await expect(insertUser("a@example.com", "+910000000001")).resolves.toEqual(expect.any(String));
    await expect(insertUser("b@example.com", "09876543210")).rejects.toThrow(/phone/i);
  });

  it("keeps audit events append-only: insert works, update and delete raise", async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO audit_events (id, "occurredAt", action, "entityType", "entityId", summary)
       VALUES (gen_random_uuid(), now(), 'user.created', 'user', 'u-1', 'User created') RETURNING id`,
    );
    const id = rows[0].id;
    await expect(
      client.query(`UPDATE audit_events SET summary = 'changed' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(client.query(`DELETE FROM audit_events WHERE id = $1`, [id])).rejects.toThrow(
      /append-only/,
    );
  });

  it("refuses to delete a role that a user still holds", async () => {
    await client.query(
      `INSERT INTO identity_roles (id, code, name, "updatedAt") VALUES (gen_random_uuid(), 'CUSTOM_PROBE', 'Probe', now())`,
    );
    await insertUser("holder@example.com", null, "CUSTOM_PROBE");
    await expect(
      client.query(`DELETE FROM identity_roles WHERE code = 'CUSTOM_PROBE'`),
    ).rejects.toThrow(/foreign key/);
  });

  it("deletes a user's sessions with the user (inside the identity module)", async () => {
    const userId = await insertUser("sessions@example.com");
    await client.query(
      `INSERT INTO identity_sessions (id, "userId", "tokenHash", "expiresAt", "lastSeenAt")
       VALUES (gen_random_uuid(), $1, 'h1', now() + interval '1 hour', now())`,
      [userId],
    );
    await client.query(`DELETE FROM identity_users WHERE id = $1`, [userId]);
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM identity_sessions`);
    expect(rows[0].n).toBe(0);
  });
});
