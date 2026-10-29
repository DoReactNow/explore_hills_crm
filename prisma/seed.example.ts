// TEMPLATE for the private real seed. Copy it and fill in your own records:
//   mkdir -p prisma/private && cp prisma/seed.example.ts prisma/private/seed.ts
// prisma/private/ is git-ignored and CI fails if anything inside it is tracked (Decision 11).
// Real values (the first Super Admin's email and password, real team members) come from .env,
// never from this file. Run it with `npm run db:seed`.
import { runRealSeed } from "@seeds/realSeed";
import { getPrisma } from "@/shared/db/prisma";

async function main(): Promise<void> {
  await runRealSeed();
  // Add your own records here, reading every real value from process.env.
}

main()
  .catch((error: unknown) => {
    console.error(`[seed] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
