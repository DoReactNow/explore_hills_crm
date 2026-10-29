// Prepares the TEST database: loads .env.test, runs the safety guards, applies migrations and
// syncs permissions and roles, then runs the test seed. Safe to run any number of times.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadTestEnv } from "../src/tests/setup/testEnv";

async function main(): Promise<void> {
  const env = loadTestEnv();
  console.log(`[prepare-test-db] database "${env.databaseName}"`);

  const require = createRequire(__filename);
  const prismaCli = require.resolve("prisma/build/index.js");
  const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env,
  });
  if (migrate.status !== 0) throw new Error("migrations failed");

  // Loaded after .env.test is in place, so the app's env and Prisma client see the test database.
  const { syncRbac } = await import("../src/modules/identity");
  const { getPrisma } = await import("../src/shared/db/prisma");
  try {
    const summary = await syncRbac();
    console.log(`[prepare-test-db] rbac synced (${summary.rolesCreated.length} roles created)`);
    const { runTestSeed } = await import("../prisma/seeds/testSeed");
    await runTestSeed();
    console.log("[prepare-test-db] test seed applied");
  } finally {
    await getPrisma().$disconnect();
  }
  console.log("[prepare-test-db] done");
}

main().catch((error: unknown) => {
  console.error(`[prepare-test-db] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
