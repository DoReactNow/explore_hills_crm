// `npm run db:seed:test`: the committed test seed (fake data, test database only).
import { runTestSeed } from "@seeds/testSeed";
import { getPrisma } from "@/shared/db/prisma";

runTestSeed()
  .then(() => console.log("[seed-test] done"))
  .catch((error: unknown) => {
    console.error(`[seed-test] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
