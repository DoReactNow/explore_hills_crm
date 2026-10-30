// Creates a real user directly in the test database, for specs that sign in through the form.
// W-108 replaces this with seeded users.
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { Client } from "pg";

export const E2E_PASSWORD = "Correct-Horse-Battery-9";

export async function createUser(roleCode: string): Promise<{ email: string; name: string }> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const email = `${randomUUID()}@example.com`;
    const name = "Tara Singh";
    await client.query(
      `INSERT INTO identity_users (id, email, name, "passwordHash", status, "roleId", "updatedAt")
       SELECT gen_random_uuid(), $1, $2, $3, 'ACTIVE', id, now() FROM identity_roles WHERE code = $4`,
      [email, name, await hash(E2E_PASSWORD), roleCode],
    );
    return { email, name };
  } finally {
    await client.end();
  }
}
