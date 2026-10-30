// W-103: the audit row commits or rolls back with the change it describes.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { getPrisma } from "@/shared/db/prisma";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { recordAudit, type AuditInput } from "..";

const prisma = getPrisma();
const SETTING_ROLE = "AUDIT_TEST_ROLE";

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
});
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

async function createUser(): Promise<string> {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: "ADMIN" } });
  const user = await prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Test User",
      passwordHash: "hash",
      status: "ACTIVE",
      roleId: role.id,
    },
  });
  return user.id;
}

const event = (overrides: Partial<AuditInput> = {}): AuditInput => ({
  action: "user.updated",
  entityType: "user",
  entityId: randomUUID(),
  summary: "User updated",
  actor: null,
  ...overrides,
});

const createRole = (tx: Parameters<typeof recordAudit>[0]) =>
  tx.identityRole.create({
    data: { code: SETTING_ROLE, name: "Audit test", description: "", isSystem: false },
  });

describe("recordAudit", () => {
  it("stores the actor, role and request ID when the transaction commits", async () => {
    const userId = await createUser();
    await prisma.$transaction((tx) =>
      recordAudit(
        tx,
        event({ actor: { userId, roleCode: "ADMIN" }, requestId: "req-1", metadata: { n: 1 } }),
      ),
    );
    const rows = await prisma.auditEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: userId,
      actorRoleCode: "ADMIN",
      requestId: "req-1",
      action: "user.updated",
      metadata: { n: 1 },
    });
  });

  it("leaves no audit row when the change rolls back (P1-AUDIT-02)", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await createRole(tx);
        await recordAudit(tx, event());
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await prisma.auditEvent.count()).toBe(0);
    expect(await prisma.identityRole.count({ where: { code: SETTING_ROLE } })).toBe(0);
  });

  it("fails the change when the audit row cannot be stored (P1-AUDIT-03)", async () => {
    const nobody = { userId: randomUUID(), roleCode: "ADMIN" };
    await expect(
      prisma.$transaction(async (tx) => {
        await createRole(tx);
        await recordAudit(tx, event({ actor: nobody }));
      }),
    ).rejects.toThrow();
    expect(await prisma.identityRole.count({ where: { code: SETTING_ROLE } })).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it("fails the change when the audit event is refused (P1-AUDIT-03, -07)", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await createRole(tx);
        await recordAudit(tx, event({ metadata: { contact: "anil@example.com" } }));
      }),
    ).rejects.toThrow(/metadata/);
    expect(await prisma.identityRole.count({ where: { code: SETTING_ROLE } })).toBe(0);
  });

  it("stores a system action with no user (P1-AUDIT-06)", async () => {
    await prisma.$transaction((tx) => recordAudit(tx, event()));
    const row = await prisma.auditEvent.findFirstOrThrow();
    expect(row.actorUserId).toBeNull();
    expect(row.actorRoleCode).toBeNull();
  });

  it("cannot be edited or deleted once stored (P1-AUDIT-04)", async () => {
    await prisma.$transaction((tx) => recordAudit(tx, event()));
    const row = await prisma.auditEvent.findFirstOrThrow();
    await expect(
      prisma.auditEvent.update({ where: { id: row.id }, data: { summary: "changed" } }),
    ).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow();
    expect((await prisma.auditEvent.findFirstOrThrow()).summary).toBe(row.summary);
  });
});
