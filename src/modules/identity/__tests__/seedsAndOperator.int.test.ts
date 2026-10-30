// W-108: seeded users, the first Super Admin and the private recovery command.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runTestSeed } from "@seeds/testSeed";
import { getPrisma } from "@/shared/db/prisma";
import { instantFromEpochMs } from "@/shared/time";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { hashPassword, syncRbac, verifyPassword } from "..";
import { createAuthService } from "../identity.auth.service";
import {
  assertOperatorTarget,
  ensureFirstSuperAdmin,
  resetSuperAdminPassword,
} from "../identity.operator";

const prisma = getPrisma();
const STRONG = "Correct-Horse-Battery-9";
const NEW_PASSWORD = "Winding-Valley-Road-77";
const env = process.env as Record<string, string>;

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
});
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

async function makeUser(roleCode: string, status: "ACTIVE" | "DEACTIVATED" = "ACTIVE") {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Tara Singh",
      passwordHash: await hashPassword(STRONG),
      status,
      roleId: role.id,
    },
  });
}

const usersSnapshot = () =>
  prisma.identityUser.findMany({
    orderBy: { email: "asc" },
    select: { id: true, email: true, name: true, status: true, passwordHash: true, roleId: true },
  });

describe("the test seed (P1-SEED-01)", () => {
  it("creates the planned users and custom role, identically when run twice", async () => {
    await runTestSeed();
    const first = await usersSnapshot();
    const byRole = await prisma.identityRole.findMany({
      select: { code: true, _count: { select: { users: true } } },
    });
    const counts = Object.fromEntries(byRole.map((role) => [role.code, role._count.users]));
    expect(counts).toMatchObject({ SUPER_ADMIN: 1, ADMIN: 1, MANAGER: 1, AGENT: 6 });
    expect(first.filter((user) => user.status === "DEACTIVATED")).toHaveLength(1);
    expect(Object.keys(counts)).toHaveLength(5); // the custom role

    await runTestSeed();
    expect(await usersSnapshot()).toEqual(first);
  });

  it("lets each TEST_* user sign in with its .env.test password", async () => {
    await runTestSeed();
    const auth = createAuthService();
    for (const role of ["SUPER_ADMIN", "ADMIN", "MANAGER", "AGENT"]) {
      const { user } = await auth.signIn(
        { email: env[`TEST_${role}_EMAIL`], password: env[`TEST_${role}_PASSWORD`] },
        { ip: `10.0.0.${role.length}` },
      );
      expect(user.role.code).toBe(role);
    }
  });

  it("clears the sign-in throttle, so repeated local test runs do not trip it", async () => {
    await prisma.identityLoginThrottle.create({
      data: { key: "ip:old", windowStart: instantFromEpochMs(0), count: 20 },
    });
    await runTestSeed();
    expect(await prisma.identityLoginThrottle.count()).toBe(0);
  });
});

describe("the first Super Admin (P1-SEED-02)", () => {
  const owner = { email: "Owner@Example.com", password: STRONG };

  it("is created active, and audited as a system action", async () => {
    expect(await ensureFirstSuperAdmin(owner)).toBe("created");
    const user = await prisma.identityUser.findUniqueOrThrow({
      where: { email: "owner@example.com" },
      include: { role: true },
    });
    expect(user.status).toBe("ACTIVE");
    expect(user.role.code).toBe("SUPER_ADMIN");
    expect(await verifyPassword(STRONG, user.passwordHash)).toBe(true);
    const event = await prisma.auditEvent.findFirstOrThrow();
    expect(event).toMatchObject({ action: "user.created", actorUserId: null });
    expect(JSON.stringify(event)).not.toContain(STRONG);
  });

  it("does nothing when an active one exists", async () => {
    await makeUser("SUPER_ADMIN");
    expect(await ensureFirstSuperAdmin(owner)).toBe("exists");
    expect(await prisma.identityUser.count()).toBe(1);
  });

  it("refuses a weak password (P1-SEED-03)", async () => {
    await expect(ensureFirstSuperAdmin({ ...owner, password: "weak" })).rejects.toThrow();
    expect(await prisma.identityUser.count()).toBe(0);
  });

  it("with only a deactivated one, creates an active one (P1-SEED-04)", async () => {
    await makeUser("SUPER_ADMIN", "DEACTIVATED");
    expect(await ensureFirstSuperAdmin(owner)).toBe("created");
  });

  it("refuses clearly if that email is already taken, changing nothing (P1-SEED-04)", async () => {
    const taken = await makeUser("AGENT");
    await expect(ensureFirstSuperAdmin({ ...owner, email: taken.email })).rejects.toThrow(
      /already belongs/,
    );
    const after = await prisma.identityUser.findUniqueOrThrow({
      where: { id: taken.id },
      include: { role: true },
    });
    expect(after.role.code).toBe("AGENT");
  });
});

describe("RBAC sync on every deploy (P1-SEED-05)", () => {
  it("never removes a user's role, and never restores a removed grant", async () => {
    const user = await makeUser("ADMIN");
    const permission = await prisma.identityPermission.findUniqueOrThrow({
      where: { code: "users:view" },
    });
    await prisma.identityRolePermission.delete({
      where: { roleId_permissionId: { roleId: user.roleId, permissionId: permission.id } },
    });
    await syncRbac();
    expect((await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } })).roleId).toBe(
      user.roleId,
    );
    expect(
      await prisma.identityRolePermission.count({
        where: { roleId: user.roleId, permissionId: permission.id },
      }),
    ).toBe(0);
  });
});

describe("the operator command (P1-PASS-13, -14)", () => {
  it("sets the password, signs the user out, clears the lock and audits", async () => {
    const user = await makeUser("SUPER_ADMIN");
    await prisma.identityUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 5, lockedUntil: instantFromEpochMs(0) },
    });
    await prisma.identitySession.create({
      data: {
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: instantFromEpochMs(4102444800000),
        lastSeenAt: instantFromEpochMs(0),
      },
    });

    await resetSuperAdminPassword({ email: user.email.toUpperCase(), password: NEW_PASSWORD });

    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(NEW_PASSWORD, row.passwordHash)).toBe(true);
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(
      await prisma.identitySession.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(0);
    const event = await prisma.auditEvent.findFirstOrThrow();
    expect(event).toMatchObject({
      action: "user.password_changed",
      entityId: user.id,
      actorUserId: null,
    });
    expect(JSON.stringify(event)).not.toContain(NEW_PASSWORD);
  });

  it("refuses a weak password, without repeating it", async () => {
    const user = await makeUser("SUPER_ADMIN");
    await expect(
      resetSuperAdminPassword({ email: user.email, password: "weaksecret" }),
    ).rejects.toThrow(/^(?!.*weaksecret)/);
    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toBe(user.passwordHash);
  });

  it("refuses an unknown account and a non-Super-Admin", async () => {
    const agent = await makeUser("AGENT");
    await expect(
      resetSuperAdminPassword({ email: "nobody@example.com", password: NEW_PASSWORD }),
    ).rejects.toThrow(/no Super Admin/i);
    await expect(
      resetSuperAdminPassword({ email: agent.email, password: NEW_PASSWORD }),
    ).rejects.toThrow(/no Super Admin/i);
    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: agent.id } });
    expect(row.passwordHash).toBe(agent.passwordHash);
  });

  it("refuses a test or mismatched database", () => {
    expect(() =>
      assertOperatorTarget({ APP_ENV: "test", databaseName: "explorehills_test" }),
    ).toThrow(/Refusing/);
    expect(() => assertOperatorTarget({ APP_ENV: "development", databaseName: "x_test" })).toThrow(
      /Refusing/,
    );
    expect(() =>
      assertOperatorTarget({ APP_ENV: "production", databaseName: "explorehills" }),
    ).not.toThrow();
  });

  it("run as a command against the test database, it refuses and never prints the password", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/modules/identity/resetSuperAdminPassword.cli.ts"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          RESET_SUPER_ADMIN_EMAIL: "a@example.com",
          RESET_SUPER_ADMIN_PASSWORD: NEW_PASSWORD,
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing/);
    expect(result.stdout + result.stderr).not.toContain(NEW_PASSWORD);
  });

  it("no web route can reach it", () => {
    const index = readFileSync("src/modules/identity/index.ts", "utf8");
    const controller = readFileSync("src/modules/identity/identity.controller.ts", "utf8");
    expect(index + controller).not.toContain("resetSuperAdminPassword");
  });
});
