// Loads .env.test over anything already set, then validates it with the app's own env
// guards plus the test-only guards. Shared by the Vitest setup and scripts/prepare-test-db.ts.
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { parseEnv, type Env } from "../../shared/config/env";
import { assertTestDatabaseUrl, assertTestStorageDir } from "./guards";

export function loadTestEnv(): Env {
  if (!existsSync(".env.test")) {
    throw new Error(
      "Tests need .env.test: copy .env.test.example to .env.test (see CONTEXT/local_setup.md).",
    );
  }
  config({ path: ".env.test", override: true, quiet: true });
  const env = parseEnv(process.env);
  if (env.APP_ENV !== "test") {
    throw new Error(`Refusing to run: .env.test must set APP_ENV=test (got "${env.APP_ENV}").`);
  }
  assertTestDatabaseUrl(env.DATABASE_URL);
  if (env.STORAGE_DRIVER === "local") assertTestStorageDir(env.STORAGE_LOCAL_DIR!);
  return env;
}
