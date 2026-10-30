// Helpers for the PRIVATE real seed (Decision 11). The real seed itself lives in
// prisma/private/seed.ts, which is git-ignored; prisma/seed.example.ts is its committed template.
// Values come from .env (SEED_SUPER_ADMIN_*), never from files.
import { checkPasswordStrength, ensureFirstSuperAdmin } from "@/modules/identity";
import { getEnv } from "@/shared/config/env";
import type { SeedTarget } from "./testSeed";

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
  if (!checkPasswordStrength(password, { email }).ok) {
    throw new Error(
      "SEED_SUPER_ADMIN_PASSWORD must be set in .env: at least 12 characters, three of lowercase, uppercase, digits and symbols, and not a placeholder or common word.",
    );
  }
  return { email, password };
}

/**
 * Runs the checks every real seed shares, then creates the first Super Admin. It does nothing if an
 * active one exists, and refuses clearly if the email belongs to another account (Decision 49).
 */
export async function runRealSeed(): Promise<void> {
  const env = getEnv();
  assertRealSeedTarget(env);
  const credentials = checkSuperAdminCredentials({
    email: process.env.SEED_SUPER_ADMIN_EMAIL,
    password: process.env.SEED_SUPER_ADMIN_PASSWORD,
  });
  const result = await ensureFirstSuperAdmin(credentials);
  console.log(
    result === "created"
      ? `[seed] created the first Super Admin in database "${env.databaseName}".`
      : `[seed] an active Super Admin already exists in database "${env.databaseName}"; nothing to do.`,
  );
}
