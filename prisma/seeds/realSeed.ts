// Helpers for the PRIVATE real seed (Decision 11). The real seed itself lives in
// prisma/private/seed.ts, which is git-ignored; prisma/seed.example.ts is its committed template.
// Values come from .env (SEED_SUPER_ADMIN_*), never from files.
import { getEnv } from "@/shared/config/env";
import type { SeedTarget } from "./testSeed";

const PLACEHOLDER = /change-me/i;
const COMMON_WORDS = /password|explorehills|qwerty|123456/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function assertRealSeedTarget({ APP_ENV, databaseName }: SeedTarget): void {
  if (APP_ENV === "test" || databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run the real seed against a test environment (APP_ENV=${APP_ENV}, database "${databaseName}").`,
    );
  }
}

export interface SuperAdminCredentials {
  email: string;
  password: string;
}

/** Validates the first Super Admin's credentials. Errors never contain the password. */
export function checkSuperAdminCredentials(input: {
  email: string | undefined;
  password: string | undefined;
}): SuperAdminCredentials {
  const email = input.email?.trim().toLowerCase() ?? "";
  if (!EMAIL.test(email)) {
    throw new Error("SEED_SUPER_ADMIN_EMAIL must be set in .env to a valid email address.");
  }

  const password = input.password ?? "";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (
    password.length < 12 ||
    classes < 3 ||
    PLACEHOLDER.test(password) ||
    COMMON_WORDS.test(password)
  ) {
    throw new Error(
      "SEED_SUPER_ADMIN_PASSWORD must be set in .env: at least 12 characters, three of lowercase, uppercase, digits and symbols, and not a placeholder or common word.",
    );
  }
  return { email, password };
}

/**
 * Runs the checks every real seed shares. Phase 0 has no user accounts, so nothing is written yet;
 * from Phase 1 this creates the first Super Admin, and does nothing if an active one exists.
 */
export async function runRealSeed(): Promise<void> {
  const env = getEnv();
  assertRealSeedTarget(env);
  checkSuperAdminCredentials({
    email: process.env.SEED_SUPER_ADMIN_EMAIL,
    password: process.env.SEED_SUPER_ADMIN_PASSWORD,
  });
  console.log(
    `[seed] checks passed for database "${env.databaseName}". User accounts arrive in Phase 1; nothing to create yet.`,
  );
}
