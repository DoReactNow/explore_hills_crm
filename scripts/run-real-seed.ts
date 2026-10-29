// `npm run db:seed`: runs the private real seed, prisma/private/seed.ts (git-ignored).
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const seedFile = resolve("prisma/private/seed.ts");

if (!existsSync(seedFile)) {
  console.error(
    [
      "[seed] prisma/private/seed.ts does not exist. Create it from the committed template:",
      "  mkdir -p prisma/private && cp prisma/seed.example.ts prisma/private/seed.ts",
      "then set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD in .env (see CONTEXT/local_setup.md Section 6).",
    ].join("\n"),
  );
  process.exit(1);
}

void import(seedFile);
