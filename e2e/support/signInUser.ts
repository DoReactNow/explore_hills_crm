// The seeded users (database_schema.md Section 10), for specs that sign in through the form.
import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

export interface SeededUser {
  email: string;
  password: string;
  name: string;
}

const NAMES = {
  SUPER_ADMIN: "Ira Sample",
  ADMIN: "Dev Sample",
  MANAGER: "Mira Sample",
  AGENT: "Ravi Sample",
};

export function seededUser(role: keyof typeof NAMES): SeededUser {
  const email = process.env[`TEST_${role}_EMAIL`];
  const password = process.env[`TEST_${role}_PASSWORD`];
  if (!email || !password) throw new Error(`TEST_${role}_* must be set in .env.test`);
  return { email, password, name: NAMES[role] };
}

/** The whole suite signs in from one address, far past the real per-IP limit of 20. */
export async function clearSignInLimit(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("DELETE FROM identity_login_throttle");
  } finally {
    await client.end();
  }
}

export async function signInThroughForm(
  page: Page,
  { email, password }: Pick<SeededUser, "email" | "password">,
): Promise<void> {
  await clearSignInLimit();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
