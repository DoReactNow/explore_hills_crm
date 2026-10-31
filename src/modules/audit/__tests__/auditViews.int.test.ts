// Phase 10: reading the audit trail. Only permitted roles, within their scope, and nothing to change.
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { parseBusinessLocalDateTime as at } from "@/shared/time";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { auditService } from "../audit.service";
import { auditViewsService as service } from "../audit.views.service";

const prisma = getPrisma();
let counter = 0;

async function makeUser(
  roleCode: string,
  managerId?: string,
  status: "ACTIVE" | "DEACTIVATED" = "ACTIVE",
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: `${roleCode} ${++counter}`,
      passwordHash: "h",
      status,
      roleId: role.id,
      managerId,
    },
  });
}
const event = (
  actorUserId: string | null,
  occurredAt: Date,
  fields: Partial<{ action: string; entityType: string; entityId: string; summary: string }> = {},
) =>
  prisma.auditEvent.create({
    data: {
      occurredAt,
      actorUserId,
      action: fields.action ?? "lead.updated",
      entityType: fields.entityType ?? "lead",
      entityId: fields.entityId ?? randomUUID(),
      summary: fields.summary ?? "Lead updated",
    },
  });
const failure = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
};
const DAY = at("2026-11-02", "12:00");

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
});
afterAll(async () => {
  await resetDatabase();
});

describe("who sees what (P10-AUDV-01)", () => {
  it("an Admin sees everyone and the system; a Manager their branch only; an Agent nothing", async () => {
    const admin = await makeUser("ADMIN");
    const manager = await makeUser("MANAGER");
    const theirs = await makeUser("AGENT", manager.id);
    const outside = await makeUser("AGENT");
    const mine = await event(manager.id, DAY);
    const below = await event(theirs.id, DAY);
    const other = await event(outside.id, DAY);
    const system = await event(null, DAY);

    const adminView = await service.list(await testPrincipal("ADMIN", admin.id), {});
    expect(adminView.events.map((row) => row.id).sort()).toEqual(
      [mine.id, below.id, other.id, system.id].sort(),
    );
    const managerView = await service.list(await testPrincipal("MANAGER", manager.id), {});
    expect(managerView.events.map((row) => row.id).sort()).toEqual([mine.id, below.id].sort());

    const agent = await testPrincipal("AGENT", theirs.id);
    expect((await failure(service.list(agent, {}))).code).toBe("FORBIDDEN");
    expect((await failure(service.options(agent))).code).toBe("FORBIDDEN");
  });

  it("a filter can't widen a Manager's view", async () => {
    const manager = await makeUser("MANAGER");
    const outside = await makeUser("AGENT");
    await event(outside.id, DAY);
    const view = await service.list(await testPrincipal("MANAGER", manager.id), {
      actorId: outside.id,
    });
    expect(view.events).toEqual([]);
    const options = await service.options(await testPrincipal("MANAGER", manager.id));
    expect(options.actors.map((person) => person.id)).not.toContain(outside.id);
    expect(options.includesSystem).toBe(false);
  });

  it("export needs its own permission, is recorded, and stays in scope (P10-AUDV-04)", async () => {
    const manager = await makeUser("MANAGER");
    expect(
      (await failure(service.exportCsv(await testPrincipal("MANAGER", manager.id), undefined, {})))
        .code,
    ).toBe("FORBIDDEN");
    const admin = await makeUser("ADMIN");
    await event(manager.id, DAY, { summary: "Lead changed, =SUM(A1)" });
    const response = await service.exportCsv(await testPrincipal("ADMIN", admin.id), "req-1", {});
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Lead changed");
    expect(text).toContain(manager.name);
    expect(await prisma.auditEvent.count({ where: { action: "audit.exported" } })).toBe(1);
  });
});

describe("filters (P10-AUDV-02)", () => {
  it("by person, record, action and date, and a deactivated person still shows", async () => {
    const admin = await testPrincipal("ADMIN", (await makeUser("ADMIN")).id);
    const gone = await makeUser("AGENT", undefined, "DEACTIVATED");
    const other = await makeUser("AGENT");
    const leadId = randomUUID();
    const a = await event(gone.id, DAY, { entityId: leadId });
    const b = await event(other.id, at("2026-11-03", "00:00"), { action: "lead.deleted" });
    const c = await event(null, at("2026-11-04", "23:59"), {
      entityType: "user",
      summary: "Other",
    });

    const ids = async (filters: Parameters<typeof service.list>[1]) =>
      (await service.list(admin, filters)).events.map((row) => row.id);
    const [row] = (await service.list(admin, { actorId: gone.id })).events;
    expect(row.actor).toMatchObject({ id: gone.id, status: "DEACTIVATED" });
    expect(await ids({ actorId: gone.id })).toEqual([a.id]);
    expect(await ids({ actorId: "system" })).toEqual([c.id]);
    expect(await ids({ entityType: "lead", entityId: leadId })).toEqual([a.id]);
    expect(await ids({ action: "lead.deleted" })).toEqual([b.id]);
    // Both end days count, by the business day.
    expect(await ids({ from: "2026-11-03", to: "2026-11-04" })).toEqual([c.id, b.id]);
    expect(await ids({ from: "2026-11-03", to: "2026-11-03" })).toEqual([b.id]);
    expect(await ids({ search: "Other" })).toEqual([c.id]);
    const people = (await service.options(admin)).actors.map((person) => person.id);
    expect(people).toEqual(expect.arrayContaining([gone.id, other.id]));
    expect(
      (await failure(service.list(admin, { from: "2026-11-05", to: "2026-11-01" }))).code,
    ).toBe("VALIDATION_FAILED");
  });

  it("searching a customer's name finds their lead's events", async () => {
    const admin = await testPrincipal("ADMIN", (await makeUser("ADMIN")).id);
    await prisma.leadsPipelineStage.create({
      data: { code: "NEW", name: "New", kind: "OPEN", position: 1 } as never,
    });
    const stage = await prisma.leadsPipelineStage.findFirstOrThrow();
    const contact = await prisma.leadsContact.create({
      data: { phoneE164: "+919800000001", name: "Riya Mehta" },
    });
    const lead = await prisma.leadsLead.create({
      data: { contactId: contact.id, stageId: stage.id },
    });
    const found = await event(null, DAY, { entityId: lead.id });
    await event(null, DAY);
    const view = await service.list(admin, { search: "riya" });
    expect(view.events.map((row) => row.id)).toEqual([found.id]);
  });

  it("pages through with no repeats", async () => {
    const admin = await testPrincipal("ADMIN", (await makeUser("ADMIN")).id);
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        id: randomUUID(),
        occurredAt: at("2026-11-02", `12:${String(index % 60).padStart(2, "0")}`),
        action: "lead.updated",
        entityType: "lead",
        entityId: randomUUID(),
        summary: "Lead updated",
      })),
    });
    const first = await service.list(admin, {});
    expect(first.events).toHaveLength(50);
    expect(first.nextAfter).not.toBeNull();
    const second = await service.list(admin, { after: first.nextAfter as string });
    expect(second.events).toHaveLength(10);
    expect(second.nextAfter).toBeNull();
    expect(new Set([...first.events, ...second.events].map((row) => row.id)).size).toBe(60);
  });
});

describe("read only (P10-AUDV-03)", () => {
  it("the routes offer GET only", () => {
    const root = join(process.cwd(), "src/app/api/audit");
    const files = [
      join(root, "route.ts"),
      ...readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name, "route.ts")),
    ];
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("export const GET");
      expect(source).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/);
    }
  });

  it("refuses a summary holding a phone number or email (P10-ERASE-11)", async () => {
    for (const summary of ["Called +91 98765 43210", "Wrote to asha@example.com"]) {
      await expect(
        prisma.$transaction((tx) =>
          auditService.recordAudit(tx, {
            action: "lead.updated",
            entityType: "lead",
            entityId: randomUUID(),
            summary,
            actor: null,
          }),
        ),
      ).rejects.toThrow("Audit summary");
    }
  });
});
