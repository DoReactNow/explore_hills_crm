// `npm run user:reset-super-admin-password` (dist/reset-super-admin-password.js in production):
// the private recovery for a forgotten Super Admin password (Decision 49). The values come from the
// environment, so the password never appears in the shell history or a process list.
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { assertOperatorTarget, resetSuperAdminPassword } from "./identity.operator";

async function main(): Promise<void> {
  assertOperatorTarget(getEnv());
  // eslint-disable-next-line no-restricted-properties
  const { RESET_SUPER_ADMIN_EMAIL: email, RESET_SUPER_ADMIN_PASSWORD: password } = process.env;
  if (!email || !password) {
    throw new Error(
      "Set RESET_SUPER_ADMIN_EMAIL and RESET_SUPER_ADMIN_PASSWORD in the environment.",
    );
  }
  await resetSuperAdminPassword({ email, password });
  console.log("[reset-super-admin-password] done. That person has been signed out everywhere.");
}

main()
  .catch((error: unknown) => {
    console.error(
      `[reset-super-admin-password] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
