// `npm run db:sync-rbac` (development) and `node dist/sync-rbac.js` (inside the migrator image).
// The database URL comes from the environment; nothing secret lives in this file.
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { logger } from "@/shared/logger";
import { syncRbac } from "./syncRbac";

async function main(): Promise<void> {
  const env = getEnv();
  const summary = await syncRbac();
  logger.info("rbac sync complete", { database: env.databaseName, ...summary });
}

main()
  .catch((error: unknown) => {
    logger.error("rbac sync failed", { err: error });
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
