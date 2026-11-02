// dist/first-super-admin.js in production: default settings, stages and the first Super Admin, from
// SEED_SUPER_ADMIN_* in the server's environment (P12-DEPLOY-05). The repository holds no credentials.
import { runRealSeed } from "@seeds/realSeed";
import { getPrisma } from "@/shared/db/prisma";

runRealSeed()
  .catch((error: unknown) => {
    console.error(`[first-super-admin] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
