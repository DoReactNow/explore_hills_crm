// The test seed (Decision 11): deterministic fixtures for the TEST database only. Credentials come
// from .env.test (TEST_*_EMAIL / TEST_*_PASSWORD), never from this file.
// It seeds the RBAC data and the users of database_schema.md Section 10; later phases add theirs.
import { createUserIfMissing, syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { ensureDefaultSettings } from "@/modules/system";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { DEFAULT_ROLES } from "@/shared/rbac/defaultRoles";

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

/** Puts built-in roles back to their defaults, so a failed test run cannot affect the next. */
async function restoreDefaultGrants(): Promise<void> {
  const prisma = getPrisma();
  for (const [code, definition] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.identityRole.findUniqueOrThrow({ where: { code } });
    const permissions = await prisma.identityPermission.findMany({
      where: { code: { in: [...definition.permissions] } },
      select: { id: true },
    });
    await prisma.identityRolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.identityRolePermission.createMany({
      data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
    });
  }
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

/** The manager's team: the first three agents report to them and belong to the team. */
async function seedTeam(): Promise<void> {
  const prisma = getPrisma();
  const manager = await prisma.identityUser.findUniqueOrThrow({
    where: { email: credential("TEST_MANAGER_EMAIL").toLowerCase() },
  });
  const team = await prisma.identityTeam.upsert({
    where: { name: "Sales North" },
    create: { name: "Sales North", managerUserId: manager.id },
    update: {},
  });
  const members = [
    credential("TEST_AGENT_EMAIL"),
    "agent2.test@example.com",
    "agent3.test@example.com",
  ];
  for (const email of members) {
    const agent = await prisma.identityUser.update({
      where: { email: email.toLowerCase() },
      data: { managerId: manager.id },
    });
    await prisma.identityTeamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: agent.id } },
      create: { teamId: team.id, userId: agent.id },
      update: {},
    });
  }
}

/** 20 unassigned leads, plus one lead in every stage owned by the seeded agent. */
async function seedLeads(): Promise<void> {
  const prisma = getPrisma();
  const stages = await prisma.leadsPipelineStage.findMany();
  const owner = await prisma.identityUser.findUniqueOrThrow({
    where: { email: credential("TEST_AGENT_EMAIL").toLowerCase() },
  });
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => ({
      phone: `+9190000${String(10000 + index)}`,
      name: `Sample Customer ${index + 1}`,
      stage: "NEW",
      ownerUserId: null as string | null,
    })),
    ...stages.map((stage, index) => ({
      phone: `+9190001${String(10000 + index)}`,
      name: `Owned Customer ${stage.name}`,
      stage: stage.code,
      ownerUserId: owner.id as string | null,
    })),
  ];
  for (const row of rows) {
    if (await prisma.leadsContact.findUnique({ where: { phoneE164: row.phone } })) continue;
    const stage = stages.find((item) => item.code === row.stage)!;
    const contact = await prisma.leadsContact.create({
      data: { phoneE164: row.phone, name: row.name },
    });
    await prisma.leadsLead.create({
      data: {
        contactId: contact.id,
        stageId: stage.id,
        ownerUserId: row.ownerUserId,
        source: "MANUAL",
        destination: "Kashmir",
        lostReason: stage.kind === "LOST" ? "Price too high" : null,
        closedAt: stage.kind === "OPEN" ? null : stage.createdAt,
        lastActivityAt: stage.createdAt,
      },
    });
  }
}

async function seedTemplates(): Promise<void> {
  await getPrisma().messagingTemplate.createMany({
    data: [
      {
        name: "Trip reminder",
        language: "en",
        category: "UTILITY",
        status: "APPROVED",
        body: "Hi {{1}}, your {{2}} trip is coming up. Reply YES for your day-by-day plan.",
      },
      {
        name: "Festive offer",
        language: "en",
        category: "MARKETING",
        status: "REJECTED",
        rejectedReason: "Marketing messages need a way to opt out.",
        body: "Hi {{1}}! Ask us about festive offers.",
      },
    ],
    skipDuplicates: true,
  });
}

/** Idempotent: running it again leaves the data unchanged. */
export async function runTestSeed(): Promise<void> {
  assertTestSeedTarget(getEnv());
  await syncRbac();
  await restoreDefaultGrants();
  await ensureDefaultSettings();
  await ensureDefaultStages();
  await seedCustomRole();
  await seedUsers();
  await seedTeam();
  await seedLeads();
  await seedTemplates();
  // Repeated local test runs would otherwise trip the per-IP sign-in limit.
  await getPrisma().identityLoginThrottle.deleteMany();
}
