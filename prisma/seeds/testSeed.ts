// The test seed (Decision 11): deterministic fixtures for the TEST database only. Credentials come
// from .env.test (TEST_*_EMAIL / TEST_*_PASSWORD), never from this file.
// Phase 0 seeds the RBAC data; Phase 1 adds the users of database_schema.md Section 10.
import { syncRbac } from "@/modules/identity";
import { getEnv } from "@/shared/config/env";

export interface SeedTarget {
  APP_ENV: string;
  databaseName: string;
}

export function assertTestSeedTarget({ APP_ENV, databaseName }: SeedTarget): void {
  if (APP_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run the test seed: it needs APP_ENV=test and a database ending in _test (got APP_ENV=${APP_ENV}, database "${databaseName}").`,
    );
  }
}

/** Idempotent: running it again leaves the data unchanged. */
export async function runTestSeed(): Promise<void> {
  assertTestSeedTarget(getEnv());
  await syncRbac();
}
