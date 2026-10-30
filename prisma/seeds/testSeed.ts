// The test seed (Decision 11): deterministic fixtures for the TEST database only. Credentials come
// from .env.test (TEST_*_EMAIL / TEST_*_PASSWORD), never from this file.
// It seeds the RBAC data and the users of database_schema.md Section 10; later phases add theirs.
import { createUserIfMissing, syncRbac } from "@/modules/identity";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";

export interface SeedTarget {
  APP_ENV: string;
  databaseName: string;
}

export function assertTestSeedTarget({ APP_ENV, databaseName }: SeedTarget): void {
  if (APP_ENV !== "test" || !databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run the test seed: it needs APP_ENV=test and a database ending in _test (got APP_ENV=${APP_ENV}, database "${databaseName}").`,
    );
  }
}

const EXTRA_AGENTS = [2, 3, 4, 5];
const CUSTOM_ROLE = {
  code: "TEAM_VIEWER",
  name: "Team viewer",
  description: "Fixture: a custom role with a small permission bundle.",
  permissions: ["users:view"],
};

function credential(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in .env.test (see .env.test.example).`);
  return value;
}

async function seedCustomRole(): Promise<void> {
  const prisma = getPrisma();
  const { permissions, ...fields } = CUSTOM_ROLE;
  const role = await prisma.identityRole.upsert({
    where: { code: fields.code },
    create: fields,
    update: {},
  });
  for (const code of permissions) {
    const permission = await prisma.identityPermission.findUniqueOrThrow({ where: { code } });
    await prisma.identityRolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      create: { roleId: role.id, permissionId: permission.id },
      update: {},
    });
  }
}

async function seedUsers(): Promise<void> {
  const agentPassword = credential("TEST_AGENT_PASSWORD");
  const users = [
    {
      email: credential("TEST_SUPER_ADMIN_EMAIL"),
      name: "Ira Sample",
      password: credential("TEST_SUPER_ADMIN_PASSWORD"),
      roleCode: "SUPER_ADMIN",
    },
    {
      email: credential("TEST_ADMIN_EMAIL"),
      name: "Dev Sample",
      password: credential("TEST_ADMIN_PASSWORD"),
      roleCode: "ADMIN",
    },
    {
      email: credential("TEST_MANAGER_EMAIL"),
      name: "Mira Sample",
      password: credential("TEST_MANAGER_PASSWORD"),
      roleCode: "MANAGER",
    },
    {
      email: credential("TEST_AGENT_EMAIL"),
      name: "Ravi Sample",
      password: agentPassword,
      roleCode: "AGENT",
    },
    ...EXTRA_AGENTS.map((number) => ({
      email: `agent${number}.test@example.com`,
      name: `Sample Colleague ${number}`,
      password: agentPassword,
      roleCode: "AGENT",
    })),
    {
      email: "agent.deactivated.test@example.com",
      name: "Former Colleague",
      password: agentPassword,
      roleCode: "AGENT",
      status: "DEACTIVATED" as const,
    },
  ];
  for (const user of users) await createUserIfMissing(user);
}

/** Idempotent: running it again leaves the data unchanged. */
export async function runTestSeed(): Promise<void> {
  assertTestSeedTarget(getEnv());
  await syncRbac();
  await seedCustomRole();
  await seedUsers();
  // Repeated local test runs would otherwise trip the per-IP sign-in limit.
  await getPrisma().identityLoginThrottle.deleteMany();
}
