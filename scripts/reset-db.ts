// `npm run db:reset:dev` / `db:reset:test`: wipes a LOCAL database and re-applies all migrations.
// It runs no seed (Decision 11): run db:sync-rbac and the seed commands yourself afterwards.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { config } from "dotenv";
import { parseEnv } from "../src/shared/config/env";
import { assertResetTarget } from "./resetDbGuard";

function main(): void {
  const envFile = process.argv[2];
  if (!envFile || !existsSync(envFile)) {
    throw new Error(`Refusing to reset: env file "${envFile ?? ""}" was not found.`);
  }
  config({ path: envFile, override: true, quiet: true });
  const env = parseEnv(process.env);
  assertResetTarget(envFile, env);

  console.log(`[reset-db] resetting database "${env.databaseName}"`);
  const prismaCli = createRequire(__filename).resolve("prisma/build/index.js");
  const reset = spawnSync(process.execPath, [prismaCli, "migrate", "reset", "--force"], {
    stdio: "inherit",
    env: process.env,
  });
  if (reset.status !== 0) throw new Error("prisma migrate reset failed");
  console.log("[reset-db] done. Next: run db:sync-rbac and any seed you need.");
}

try {
  main();
} catch (error) {
  console.error(`[reset-db] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
