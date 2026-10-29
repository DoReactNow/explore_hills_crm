// Prepares the TEST database: loads .env.test, runs the safety guards, applies migrations.
// W-005 adds the RBAC sync and W-009 the test seed. Safe to run any number of times.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadTestEnv } from "../src/tests/setup/testEnv";

const env = loadTestEnv();
console.log(`[prepare-test-db] database "${env.databaseName}"`);

const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");
const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
});
if (migrate.status !== 0) {
  console.error("[prepare-test-db] migrations failed");
  process.exit(migrate.status ?? 1);
}
console.log("[prepare-test-db] done");
