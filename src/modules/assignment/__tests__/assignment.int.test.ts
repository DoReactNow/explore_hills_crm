// Phase 5: the queue, every mode through to the database, blast, timeouts, reassigning and leaving
// staff. Run against real Postgres, because the rules that matter here are about concurrency.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { createLeadService, ensureDefaultStages } from "@/modules/leads";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import type { Principal } from "@/shared/rbac/principal";
import { createTestClock, instantFromEpochMs, parseBusinessLocalDateTime } from "@/shared/time";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { createAssignmentService, type AssignmentContext } from "../assignment.service";

const prisma = getPrisma();
// 2026-11-02 is a Monday; noon in the business timezone.
const NOON = parseBusinessLocalDateTime("2026-11-02", "12:00");
const MINUTE = 60_000;

let clock: ReturnType<typeof createTestClock>;
let service: ReturnType<typeof createAssignmentService>;
let leadService: ReturnType<typeof createLeadService>;
let counter = 0;
let manager: AssignmentContext;

async function makeUser(
  roleCode = "AGENT",
  options: {
    managerId?: string;
    status?: "ACTIVE" | "DEACTIVATED" | "INVITED";
    name?: string;
  } = {},
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: options.name ?? `${roleCode} ${++counter}`,
      passwordHash: "h",
      status: options.status ?? "ACTIVE",
      roleId: role.id,
      managerId: options.managerId,
    },
  });
}
const contextOf = async (roleCode: string, userId: string): Promise<AssignmentContext> => ({
  principal: (await testPrincipal(roleCode, userId)) as Principal,
  requestId: "req",
});
const agentOf = async (managerId = manager.principal.userId, name?: string) =>
  makeUser("AGENT", { managerId, name });
const agentContext = (id: string) => contextOf("AGENT", id);

async function makeLead(
  fields: { ownerUserId?: string; destination?: string; budget?: number; ageMinutes?: number } = {},
) {
  const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
  const contact = await prisma.leadsContact.create({
    data: { phoneE164: `+9198${String(30000000 + ++counter)}`, name: `Customer ${counter}` },
  });
  return prisma.leadsLead.create({
    data: {
      contactId: contact.id,
      stageId: stage.id,
      ownerUserId: fields.ownerUserId,
      destination: fields.destination,
      budgetAmount: fields.budget,
      createdAt: instantFromEpochMs(NOON.getTime() - (fields.ageMinutes ?? 10) * MINUTE),
    },
  });
}
const makeLeads = (count: number) => Promise.all(Array.from({ length: count }, () => makeLead()));
const ownerOf = async (id: string) =>
  (await prisma.leadsLead.findUniqueOrThrow({ where: { id } })).ownerUserId;
const failure = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
};

/** Previews and confirms in one step, as the screen does. */
async function assign(
  context: AssignmentContext,
  leadIds: string[],
  userIds: string[],
  mode: "MANUAL" | "ROUND_ROBIN" | "LEAST_LOADED" | "RANDOM" | "PRIORITY" = "ROUND_ROBIN",
) {
  const preview = await service.preview(context, { leadIds, userIds, mode });
  return service.commit(context, {
    idempotencyKey: randomUUID(),
    mode,
    rows: preview.rows.map(({ leadId, userId }) => ({ leadId, userId })),
  });
}
async function blast(context: AssignmentContext, leadIds: string[], userIds: string[]) {
  return service.commit(context, {
    idempotencyKey: randomUUID(),
    mode: "BLAST",
    offers: { leadIds, userIds },
  });
}
const onlyPoolEntry = (leadId: string) =>
  prisma.assignmentPoolEntry.findFirstOrThrow({
    where: { leadId },
    orderBy: { createdAt: "desc" },
  });

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
  clock = createTestClock(NOON.toISOString());
  service = createAssignmentService({ clock, enqueue: false });
  leadService = createLeadService({ clock });
  const person = await makeUser("MANAGER");
  manager = await contextOf("MANAGER", person.id);
});
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("the queue", () => {
  it("lists only unassigned, open, undeleted leads in scope (P5-QUEUE-01)", async () => {
    const agent = await agentOf();
    const waiting = await makeLead();
    await makeLead({ ownerUserId: agent.id });
    const deleted = await makeLead();
    await prisma.leadsLead.update({ where: { id: deleted.id }, data: { deletedAt: NOON } });
    const lost = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "LOST" } });
    const closed = await makeLead();
    await prisma.leadsLead.update({ where: { id: closed.id }, data: { stageId: lost.id } });

    const queue = await service.listQueue(manager, { page: 1, pageSize: 50, filter: "all" });
    expect(queue.items.map((lead) => lead.id)).toEqual([waiting.id]);
    expect(queue.total).toBe(1);
  });

  it("marks a lead that is in a pool or waiting for a manager", async () => {
    const agent = await agentOf();
    const [pooled, flagged] = await makeLeads(2);
    await blast(manager, [pooled.id], [agent.id]);
    await prisma.assignmentEscalation.create({
      data: { leadId: flagged.id, timeouts: 2, escalatedAt: NOON },
    });
    const { items } = await service.listQueue(manager, { page: 1, pageSize: 50, filter: "all" });
    const byId = new Map(items.map((lead) => [lead.id, lead]));
    expect(byId.get(pooled.id)?.poolEntryId).toBeTruthy();
    expect(byId.get(flagged.id)?.escalated).toBe(true);
  });
});

describe("preview and confirm", () => {
  it("changes nothing on preview and shows exactly who gets what (P5-QUEUE-02)", async () => {
    const [a, b] = [await agentOf(), await agentOf()];
    const leads = await makeLeads(4);
    const preview = await service.preview(manager, {
      leadIds: leads.map((lead) => lead.id),
      userIds: [a.id, b.id],
      mode: "ROUND_ROBIN",
    });
    expect(preview.rows).toHaveLength(4);
    expect(preview.agents.find((row) => row.id === a.id)?.adding).toBe(2);
    expect(await prisma.assignmentRecord.count()).toBe(0);
    expect(await ownerOf(leads[0].id)).toBeNull();
  });

  it("assigns what was previewed, with history, timeline and audit (P5-REASSIGN-06)", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    const result = await assign(manager, [lead.id], [a.id], "MANUAL");
    expect(result.assignedCount).toBe(1);
    expect(await ownerOf(lead.id)).toBe(a.id);
    const record = await prisma.assignmentRecord.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(record).toMatchObject({
      fromUserId: null,
      toUserId: a.id,
      actorUserId: manager.principal.userId,
      mode: "MANUAL",
    });
    expect(record.responseDueAt).toEqual(instantFromEpochMs(NOON.getTime() + 30 * MINUTE));
    expect(
      await prisma.leadsTimelineEntry.count({ where: { leadId: lead.id, kind: "ASSIGNED" } }),
    ).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "assignment.batch_committed" } })).toBe(
      1,
    );
  });

  it("skips a lead someone else took, and says so (P5-QUEUE-03)", async () => {
    const [a, b] = [await agentOf(), await agentOf()];
    const [taken, free] = await makeLeads(2);
    const preview = await service.preview(manager, {
      leadIds: [taken.id, free.id],
      userIds: [a.id],
      mode: "MANUAL",
    });
    await prisma.leadsLead.update({ where: { id: taken.id }, data: { ownerUserId: b.id } });
    const result = await service.commit(manager, {
      idempotencyKey: randomUUID(),
      mode: "MANUAL",
      rows: preview.rows.map(({ leadId, userId }) => ({ leadId, userId })),
    });
    expect(result).toMatchObject({ assignedCount: 1, skippedTaken: 1 });
    expect(await ownerOf(taken.id)).toBe(b.id);
    expect(await ownerOf(free.id)).toBe(a.id);
  });

  it("leaves a lead in the queue when its agent stopped being eligible (P5-QUEUE-04)", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    const preview = await service.preview(manager, {
      leadIds: [lead.id],
      userIds: [a.id],
      mode: "MANUAL",
    });
    await prisma.identityUser.update({ where: { id: a.id }, data: { status: "DEACTIVATED" } });
    const result = await service.commit(manager, {
      idempotencyKey: randomUUID(),
      mode: "MANUAL",
      rows: preview.rows.map(({ leadId, userId }) => ({ leadId, userId })),
    });
    expect(result).toMatchObject({ assignedCount: 0, leftInQueue: 1 });
    expect(await ownerOf(lead.id)).toBeNull();
  });

  it("refuses an agent outside the manager's branch (P5-QUEUE-05)", async () => {
    const outsider = await makeUser("AGENT");
    const [lead] = await makeLeads(1);
    const error = await failure(
      service.commit(manager, {
        idempotencyKey: randomUUID(),
        mode: "MANUAL",
        rows: [{ leadId: lead.id, userId: outsider.id }],
      }),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(await ownerOf(lead.id)).toBeNull();
  });

  it("gives no plan with no eligible agents, and changes nothing (P5-QUEUE-06)", async () => {
    const [lead] = await makeLeads(1);
    const preview = await service.preview(manager, {
      leadIds: [lead.id],
      userIds: [],
      mode: "ROUND_ROBIN",
    });
    expect(preview.rows).toEqual([]);
    expect(preview.unplaced).toEqual([lead.id]);
  });

  it("'all' means what the preview showed, not later arrivals (P5-QUEUE-07)", async () => {
    const a = await agentOf();
    const shown = await makeLead();
    const preview = await service.preview(manager, { all: true, userIds: [a.id], mode: "MANUAL" });
    const later = await makeLead();
    await service.commit(manager, {
      idempotencyKey: randomUUID(),
      mode: "MANUAL",
      rows: preview.rows.map(({ leadId, userId }) => ({ leadId, userId })),
    });
    expect(await ownerOf(shown.id)).toBe(a.id);
    expect(await ownerOf(later.id)).toBeNull();
  });

  it("rolls back everything when anything fails (P5-QUEUE-08)", async () => {
    const a = await agentOf();
    const leads = await makeLeads(3);
    const broken = createAssignmentService({
      clock,
      enqueue: false,
      beforeCommitForTests: () => {
        throw new Error("the disk is full");
      },
    });
    await expect(
      broken.commit(manager, {
        idempotencyKey: randomUUID(),
        mode: "MANUAL",
        rows: leads.map((lead) => ({ leadId: lead.id, userId: a.id })),
      }),
    ).rejects.toThrow("the disk is full");
    expect(await prisma.leadsLead.count({ where: { ownerUserId: a.id } })).toBe(0);
    expect(await prisma.assignmentRecord.count()).toBe(0);
    expect(await prisma.assignmentBatch.count()).toBe(0);
  });

  it("completes a batch of 2,000 leads promptly (P5-QUEUE-09)", async () => {
    const a = await agentOf();
    await prisma.assignmentAgentSetting.create({ data: { userId: a.id, openLeadCap: 5000 } });
    const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
    const contacts = Array.from({ length: 2000 }, (_, i) => ({
      id: randomUUID(),
      phoneE164: `+9197${String(10000000 + i)}`,
    }));
    await prisma.leadsContact.createMany({ data: contacts });
    const ids = contacts.map(() => randomUUID());
    await prisma.leadsLead.createMany({
      data: contacts.map((contact, i) => ({
        id: ids[i],
        contactId: contact.id,
        stageId: stage.id,
      })),
    });
    const started = performance.now();
    const result = await service.commit(manager, {
      idempotencyKey: randomUUID(),
      mode: "MANUAL",
      rows: ids.map((leadId) => ({ leadId, userId: a.id })),
    });
    expect(result.assignedCount).toBe(2000);
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 60_000);

  it("gives each lead one owner when two managers race (P5-QUEUE-10)", async () => {
    const [a, b] = [await agentOf(), await agentOf()];
    const leads = await makeLeads(10);
    const ids = leads.map((lead) => lead.id);
    const results = await Promise.all([
      service.commit(manager, {
        idempotencyKey: randomUUID(),
        mode: "MANUAL",
        rows: ids.map((leadId) => ({ leadId, userId: a.id })),
      }),
      service.commit(manager, {
        idempotencyKey: randomUUID(),
        mode: "MANUAL",
        rows: ids.map((leadId) => ({ leadId, userId: b.id })),
      }),
    ]);
    expect(results[0].assignedCount + results[1].assignedCount).toBe(10);
    expect(await prisma.assignmentRecord.count()).toBe(10);
  });

  it("does nothing on a repeat, and refuses a reused key with new content (P5-QUEUE-11)", async () => {
    const [a, b] = [await agentOf(), await agentOf()];
    const [lead, other] = await makeLeads(2);
    const key = randomUUID();
    const rows = [{ leadId: lead.id, userId: a.id }];
    const first = await service.commit(manager, { idempotencyKey: key, mode: "MANUAL", rows });
    const again = await service.commit(manager, { idempotencyKey: key, mode: "MANUAL", rows });
    expect(again).toEqual(first);
    expect(await prisma.assignmentRecord.count()).toBe(1);
    const error = await failure(
      service.commit(manager, {
        idempotencyKey: key,
        mode: "MANUAL",
        rows: [{ leadId: other.id, userId: b.id }],
      }),
    );
    expect(error.code).toBe("CONFLICT");
  });

  it("can be undone by its requester within 30 seconds, while nobody has acted", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    const { batchId } = await assign(manager, [lead.id], [a.id], "MANUAL");
    clock.advance(29_000);
    expect(await service.undo(manager, batchId)).toEqual({ undone: 1 });
    expect(await ownerOf(lead.id)).toBeNull();

    const second = await assign(manager, [lead.id], [a.id], "MANUAL");
    clock.advance(31_000);
    expect((await failure(service.undo(manager, second.batchId))).code).toBe("CONFLICT");
    expect(await ownerOf(lead.id)).toBe(a.id);
  });
});

describe("who can be chosen", () => {
  it("never chooses deactivated or invited people (P5-ELIG-01)", async () => {
    const managerId = manager.principal.userId;
    const gone = await makeUser("AGENT", { managerId, status: "DEACTIVATED" });
    const invited = await makeUser("AGENT", { managerId, status: "INVITED" });
    const active = await agentOf();
    const [lead] = await makeLeads(1);
    const preview = await service.preview(manager, {
      leadIds: [lead.id],
      userIds: [gone.id, invited.id, active.id],
      mode: "ROUND_ROBIN",
    });
    expect(preview.rows).toEqual([expect.objectContaining({ userId: active.id })]);
  });

  it("goes by the permission, not the role's name (P5-ELIG-07)", async () => {
    const managerId = manager.principal.userId;
    const fellowManager = await makeUser("MANAGER", { managerId });
    const custom = await prisma.identityRole.create({
      data: { code: "SENIOR_SELLER", name: "Senior seller", description: "", isSystem: false },
    });
    const permission = await prisma.identityPermission.findUniqueOrThrow({
      where: { code: "leads:claim" },
    });
    await prisma.identityRolePermission.create({
      data: { roleId: custom.id, permissionId: permission.id },
    });
    const seller = await makeUser("SENIOR_SELLER", { managerId });
    const agents = await service.listAgents(manager);
    expect(agents.items.map((row) => row.id)).toContain(seller.id);
    expect(agents.items.map((row) => row.id)).not.toContain(fellowManager.id);
  });

  it("counts only open leads toward the cap (P5-MODE-09), personal cap first (P5-ELIG-05)", async () => {
    const a = await agentOf();
    await prisma.assignmentAgentSetting.create({ data: { userId: a.id, openLeadCap: 1 } });
    const closedLead = await makeLead({ ownerUserId: a.id });
    const won = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "WON" } });
    await prisma.leadsLead.update({ where: { id: closedLead.id }, data: { stageId: won.id } });
    const row = (await service.listAgents(manager)).items.find((item) => item.id === a.id);
    expect(row).toMatchObject({ openLeads: 0, cap: 1, block: null });

    const leads = await makeLeads(2);
    const preview = await service.preview(manager, {
      leadIds: leads.map((lead) => lead.id),
      userIds: [a.id],
      mode: "MANUAL",
    });
    expect(preview.rows).toHaveLength(1);
    expect(preview.unplaced).toHaveLength(1); // P5-MODE-07
  });

  it("rotates round-robin across batches (P5-MODE-02)", async () => {
    const [a, b] = [await agentOf(), await agentOf()];
    const [first, second] = await makeLeads(2);
    const one = await assign(manager, [first.id], [a.id, b.id]);
    clock.advance(1000);
    const two = await assign(manager, [second.id], [a.id, b.id]);
    expect(await ownerOf(first.id)).not.toBe(await ownerOf(second.id));
    expect(one.assignedCount + two.assignedCount).toBe(2);
  });

  it("saves an agent's settings, shifts included, and refuses bad ones", async () => {
    const a = await agentOf();
    await service.updateAgentSettings(manager, a.id, {
      isAvailable: true,
      openLeadCap: 9,
      priorityTier: 2,
      languages: ["Hindi"],
      destinations: ["Ladakh"],
      leaveFromDate: "2026-11-20",
      leaveToDate: "2026-11-24",
      shifts: [{ weekday: 1, startMinute: 1320, endMinute: 360 }],
    });
    const row = (await service.listAgents(manager)).items.find((item) => item.id === a.id);
    expect(row).toMatchObject({ cap: 9, tier: 2, block: "off_shift" });
    const error = await failure(
      service.updateAgentSettings(manager, a.id, {
        isAvailable: true,
        openLeadCap: null,
        priorityTier: 0,
        languages: [],
        destinations: [],
        leaveFromDate: "2026-11-24",
        leaveToDate: "2026-11-20",
        shifts: [],
      }),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
  });
});

describe("blast", () => {
  it("keeps one open entry per lead (P5-BLAST-01), and refuses zero agents (P5-BLAST-12)", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    expect((await failure(blast(manager, [lead.id], []))).code).toBe("VALIDATION_FAILED");
    expect((await blast(manager, [lead.id], [a.id])).pooledCount).toBe(1);
    expect((await blast(manager, [lead.id], [a.id])).pooledCount).toBe(0);
    expect(await prisma.assignmentPoolEntry.count({ where: { status: "OPEN" } })).toBe(1);
  });

  it("shows and offers an entry only to those eligible (P5-BLAST-02)", async () => {
    const [a, b] = [await agentOf(), await agentOf()];
    const [lead] = await makeLeads(1);
    await blast(manager, [lead.id], [a.id]);
    const entry = await onlyPoolEntry(lead.id);
    expect((await service.listPool(await agentContext(a.id))).items).toHaveLength(1);
    expect((await service.listPool(await agentContext(b.id))).items).toHaveLength(0);
    const error = await failure(service.claim(await agentContext(b.id), entry.id));
    expect(error.code).toBe("NOT_FOUND");
  });

  it("lets exactly one of many win (P5-BLAST-03), and a repeat is harmless (P5-BLAST-04)", async () => {
    const agents = await Promise.all(Array.from({ length: 6 }, () => agentOf()));
    const [lead] = await makeLeads(1);
    await blast(
      manager,
      [lead.id],
      agents.map((agent) => agent.id),
    );
    const entry = await onlyPoolEntry(lead.id);
    const contexts = await Promise.all(agents.map((agent) => agentContext(agent.id)));
    const results = await Promise.allSettled(contexts.map((c) => service.claim(c, entry.id)));
    const won = results.flatMap((r, i) => (r.status === "fulfilled" ? [i] : []));
    expect(won).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect((result.reason as AppError).fieldErrors?.[0].message).toMatch(/already taken/i);
      }
    }
    expect(await ownerOf(lead.id)).toBe(agents[won[0]].id);
    await expect(service.claim(contexts[won[0]], entry.id)).resolves.toBeTruthy();
    expect(await prisma.assignmentRecord.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("has exactly one outcome at the moment of expiry (P5-BLAST-05)", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    await blast(manager, [lead.id], [a.id]);
    const entry = await onlyPoolEntry(lead.id);
    clock.advance(5 * MINUTE);
    const [claim] = await Promise.allSettled([
      service.claim(await agentContext(a.id), entry.id),
      service.sweep(),
    ]);
    expect(claim.status).toBe("rejected");
    expect((await onlyPoolEntry(lead.id)).status).toBe("EXPIRED");
    expect(await ownerOf(lead.id)).toBeNull();
  });

  it("refuses an agent who became ineligible (P5-BLAST-06)", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    await blast(manager, [lead.id], [a.id]);
    const entry = await onlyPoolEntry(lead.id);
    await prisma.assignmentAgentSetting.create({ data: { userId: a.id, isAvailable: false } });
    const error = await failure(service.claim(await agentContext(a.id), entry.id));
    expect(error.code).toBe("CONFLICT");
    expect((await onlyPoolEntry(lead.id)).status).toBe("OPEN");
  });

  it("holds the cap when one agent claims many at once (P5-BLAST-07)", async () => {
    const a = await agentOf();
    await prisma.assignmentAgentSetting.create({ data: { userId: a.id, openLeadCap: 2 } });
    const leads = await makeLeads(5);
    await blast(
      manager,
      leads.map((lead) => lead.id),
      [a.id],
    );
    const context = await agentContext(a.id);
    const entries = await prisma.assignmentPoolEntry.findMany();
    const results = await Promise.allSettled(entries.map((e) => service.claim(context, e.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await prisma.leadsLead.count({ where: { ownerUserId: a.id } })).toBe(2);
  });

  it("returns an unclaimed lead to the queue on expiry (P5-BLAST-08)", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    await blast(manager, [lead.id], [a.id]);
    clock.advance(5 * MINUTE - 1);
    await service.sweep();
    expect((await onlyPoolEntry(lead.id)).status).toBe("OPEN");
    clock.advance(1);
    await service.sweep();
    expect((await onlyPoolEntry(lead.id)).status).toBe("EXPIRED");
    const { items } = await service.listQueue(manager, { page: 1, pageSize: 50, filter: "all" });
    expect(items[0].poolEntryId).toBeNull();
  });

  it("has one outcome when a manager cancels during a claim (P5-BLAST-09)", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    await blast(manager, [lead.id], [a.id]);
    const entry = await onlyPoolEntry(lead.id);
    await Promise.allSettled([
      service.claim(await agentContext(a.id), entry.id),
      service.cancelPoolEntry(manager, entry.id),
    ]);
    const after = await onlyPoolEntry(lead.id);
    if (after.status === "CLAIMED") expect(await ownerOf(lead.id)).toBe(a.id);
    else {
      expect(after.status).toBe("CANCELLED");
      expect(await ownerOf(lead.id)).toBeNull();
    }
  });

  it("drops a lead from the pool when assigned or deleted (P5-BLAST-10, P4-MERGE-03)", async () => {
    const a = await agentOf();
    const [assigned, deleted] = await makeLeads(2);
    await blast(manager, [assigned.id, deleted.id], [a.id]);
    await assign(manager, [assigned.id], [a.id], "MANUAL");
    expect((await onlyPoolEntry(assigned.id)).status).toBe("CANCELLED");
    await prisma.leadsLead.update({ where: { id: deleted.id }, data: { deletedAt: NOON } });
    const context = await agentContext(a.id);
    expect((await service.listPool(context)).items).toHaveLength(0);
    const entry = await onlyPoolEntry(deleted.id);
    expect((await failure(service.claim(context, entry.id))).code).toBe("NOT_FOUND");
  });
});

describe("timeouts", () => {
  async function assigned(ownerShifts?: boolean) {
    const a = await agentOf();
    if (ownerShifts) {
      await prisma.assignmentAgentSetting.create({
        data: {
          userId: a.id,
          shifts: { create: [{ weekday: 1, startMinute: 540, endMinute: 780 }] },
        },
      });
    }
    const [lead] = await makeLeads(1);
    await assign(manager, [lead.id], [a.id], "MANUAL");
    const record = await prisma.assignmentRecord.findFirstOrThrow({ where: { leadId: lead.id } });
    return { a, lead, record };
  }

  it("returns an untouched lead exactly at its deadline (P5-TIMEOUT-01)", async () => {
    const { lead, record } = await assigned();
    clock.advance(30 * MINUTE - 1);
    await service.processTimeout(record.id);
    expect(await ownerOf(lead.id)).not.toBeNull();
    clock.advance(1);
    await service.processTimeout(record.id);
    expect(await ownerOf(lead.id)).toBeNull();
    const after = await prisma.assignmentRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.timedOutAt).toBeTruthy();
  });

  it.each(["note", "stage", "task", "timeline"] as const)(
    "is cancelled by the owner's action: %s (P5-TIMEOUT-02)",
    async (kind) => {
      const { a, lead, record } = await assigned();
      const context = await agentContext(a.id);
      clock.advance(MINUTE);
      if (kind === "note") await leadService.addNote(context, lead.id, { body: "Called back" });
      if (kind === "stage")
        await leadService.moveStage(context, lead.id, { stageCode: "CONTACTED" });
      if (kind === "task") {
        await prisma.leadsTimelineEntry.create({
          data: {
            leadId: lead.id,
            kind: "TASK",
            summary: "Follow-up added",
            actorUserId: a.id,
            occurredAt: instantFromEpochMs(NOON.getTime() + MINUTE),
          },
        });
      }
      if (kind === "timeline") {
        await prisma.leadsTimelineEntry.create({
          data: {
            leadId: lead.id,
            kind: "MESSAGE",
            summary: "Replied",
            actorUserId: a.id,
            occurredAt: instantFromEpochMs(NOON.getTime() + MINUTE),
          },
        });
      }
      clock.advance(30 * MINUTE);
      await service.processTimeout(record.id);
      expect(await ownerOf(lead.id)).toBe(a.id);
      const after = await prisma.assignmentRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(after.respondedAt).toBeTruthy();
      expect(after.timedOutAt).toBeNull();
    },
  );

  it("is not cancelled by a customer message or someone else's note (P5-TIMEOUT-02)", async () => {
    const { lead, record } = await assigned();
    await prisma.leadsTimelineEntry.create({
      data: { leadId: lead.id, kind: "MESSAGE", summary: "Customer wrote", occurredAt: NOON },
    });
    await prisma.leadsTimelineEntry.create({
      data: {
        leadId: lead.id,
        kind: "NOTE",
        summary: "Manager note",
        actorUserId: manager.principal.userId,
        occurredAt: NOON,
      },
    });
    clock.advance(30 * MINUTE);
    await service.processTimeout(record.id);
    expect(await ownerOf(lead.id)).toBeNull();
  });

  it("does nothing when it arrives after a reassignment or closing (P5-TIMEOUT-04)", async () => {
    const { lead, record } = await assigned();
    const other = await agentOf();
    await service.reassign(manager, lead.id, { toUserId: other.id, reason: "Speaks Tamil" });
    const stopped = await prisma.assignmentRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(stopped.responseDueAt).toBeNull();
    clock.advance(30 * MINUTE);
    await service.processTimeout(record.id);
    expect(await ownerOf(lead.id)).toBe(other.id);
    const old = await prisma.assignmentRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(old.timedOutAt).toBeNull();
    expect(old.responseDueAt).toBeNull();
  });

  it("does nothing when the owner changed some other way, and stops the timer (P5-TIMEOUT-04)", async () => {
    const { lead, record } = await assigned();
    const other = await agentOf();
    await prisma.leadsLead.update({ where: { id: lead.id }, data: { ownerUserId: other.id } });
    clock.advance(30 * MINUTE);
    await service.processTimeout(record.id);
    expect(await ownerOf(lead.id)).toBe(other.id);
    const old = await prisma.assignmentRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(old.timedOutAt).toBeNull();
    expect(old.responseDueAt).toBeNull();
  });

  it("acts once when the job and the sweeper race (P5-TIMEOUT-05, -08)", async () => {
    const { lead, record } = await assigned();
    clock.advance(45 * MINUTE);
    await Promise.all([
      service.processTimeout(record.id),
      service.processTimeout(record.id),
      service.sweep(),
      service.sweep(),
    ]);
    expect(await ownerOf(lead.id)).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "assignment.timed_out" } })).toBe(1);
  });

  it("flags for a manager at the limit, and a response resets the count (P5-TIMEOUT-06)", async () => {
    const a = await agentOf();
    const [lead] = await makeLeads(1);
    const miss = async () => {
      await assign(manager, [lead.id], [a.id], "MANUAL");
      clock.advance(30 * MINUTE);
      await service.sweep();
    };
    await miss();
    expect(await prisma.assignmentEscalation.count()).toBe(0);
    await miss();
    expect(await prisma.assignmentEscalation.count()).toBe(1);
    expect(
      (await service.listQueue(manager, { page: 1, pageSize: 5, filter: "all" })).items[0],
    ).toMatchObject({ escalated: true });
    // Assigning clears the flag, and a response starts the count again.
    await assign(manager, [lead.id], [a.id], "MANUAL");
    expect(await prisma.assignmentEscalation.count()).toBe(0);
    clock.advance(MINUTE);
    await leadService.addNote(await agentContext(a.id), lead.id, { body: "On it" });
    clock.advance(30 * MINUTE);
    await service.sweep();
    const next = await agentOf();
    await service.reassign(manager, lead.id, { toUserId: next.id, reason: "Rebalancing" });
    clock.advance(30 * MINUTE);
    await service.sweep();
    expect(await ownerOf(lead.id)).toBeNull();
    expect(await prisma.assignmentEscalation.count()).toBe(0);
  });

  it("returns to the queue with no agents left (P5-TIMEOUT-07)", async () => {
    const { a, lead, record } = await assigned();
    await prisma.identityUser.update({ where: { id: a.id }, data: { status: "DEACTIVATED" } });
    clock.advance(30 * MINUTE);
    await service.processTimeout(record.id);
    expect(await ownerOf(lead.id)).toBeNull();
  });

  it("pauses outside the agent's shift (P5-TIMEOUT-09)", async () => {
    // Shift Monday 09:00-13:00; noon leaves 60 minutes, so 30 fits today.
    const { record } = await assigned(true);
    expect(record.responseDueAt).toEqual(instantFromEpochMs(NOON.getTime() + 30 * MINUTE));
    clock.advance(45 * MINUTE); // 12:45, off shift soon
    const next = await assigned(true);
    // 15 minutes today, then the other 15 next Monday from 09:00.
    expect(next.record.responseDueAt).toEqual(parseBusinessLocalDateTime("2026-11-09", "09:15"));
  });

  it("keeps a set deadline when the setting changes (P5-TIMEOUT-10)", async () => {
    const { record } = await assigned();
    await prisma.systemSetting.create({
      data: { key: "assignment.timeoutMinutes", value: 5 },
    });
    const after = await prisma.assignmentRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.responseDueAt).toEqual(record.responseDueAt);
    clock.advance(6 * MINUTE);
    await service.processTimeout(record.id);
    expect(after.timedOutAt).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "assignment.timed_out" } })).toBe(0);
  });
});

describe("reassigning", () => {
  it("needs a reason and its own permission (P5-REASSIGN-01)", async () => {
    const a = await agentOf();
    const lead = await makeLead({ ownerUserId: a.id });
    const error = await failure(
      service.reassign(await agentContext(a.id), lead.id, { toUserId: a.id, reason: "x" }),
    );
    expect(error.code).toBe("FORBIDDEN");
  });

  it("does nothing when the new owner is the current one (P5-REASSIGN-02)", async () => {
    const a = await agentOf();
    const lead = await makeLead({ ownerUserId: a.id });
    await service.reassign(manager, lead.id, { toUserId: a.id, reason: "No change" });
    expect(await prisma.assignmentRecord.count()).toBe(0);
    expect(await prisma.leadsTimelineEntry.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("moves tasks, records it all, and shuts the old owner out (P5-REASSIGN-04, -05, -06, P3-NOTE-07)", async () => {
    const [a, b] = [await agentOf(), await agentOf()];
    const lead = await makeLead({ ownerUserId: a.id });
    const open = await prisma.leadsTask.create({
      data: { leadId: lead.id, assigneeUserId: a.id, title: "Call", dueDate: NOON },
    });
    const done = await prisma.leadsTask.create({
      data: {
        leadId: lead.id,
        assigneeUserId: a.id,
        title: "Old",
        dueDate: NOON,
        completedAt: NOON,
      },
    });
    await service.reassign(manager, lead.id, { toUserId: b.id, reason: "Speaks Tamil" });

    expect(await ownerOf(lead.id)).toBe(b.id);
    const tasks = await prisma.leadsTask.findMany({ where: { leadId: lead.id } });
    expect(tasks.find((task) => task.id === open.id)?.assigneeUserId).toBe(b.id);
    expect(tasks.find((task) => task.id === done.id)?.assigneeUserId).toBe(a.id);
    expect(await prisma.assignmentRecord.findFirstOrThrow()).toMatchObject({
      fromUserId: a.id,
      toUserId: b.id,
      actorUserId: manager.principal.userId,
      mode: "MANUAL",
      reason: "Speaks Tamil",
    });
    expect(await prisma.auditEvent.count({ where: { action: "assignment.reassigned" } })).toBe(1);
    const oldOwner = await agentContext(a.id);
    const error = await failure(leadService.getLead(oldOwner, lead.id));
    expect(error.code).toBe("NOT_FOUND");
  });

  it("refuses someone who can't be given leads", async () => {
    const a = await agentOf();
    const fellow = await makeUser("MANAGER", { managerId: manager.principal.userId });
    const lead = await makeLead({ ownerUserId: a.id });
    const error = await failure(
      service.reassign(manager, lead.id, { toUserId: fellow.id, reason: "Busy" }),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
  });
});

describe("a deactivated agent's leads (P5-REASSIGN-03, P2-UMGMT-03)", () => {
  async function adminDeactivating(
    target: string,
    choice: Parameters<typeof service.deactivateUser>[2],
  ) {
    const admin = await makeUser("ADMIN");
    return service.deactivateUser(await contextOf("ADMIN", admin.id), target, choice);
  }
  async function setUp() {
    const a = await agentOf();
    const lead = await makeLead({ ownerUserId: a.id });
    await prisma.leadsTask.create({
      data: { leadId: lead.id, assigneeUserId: a.id, title: "Call", dueDate: NOON },
    });
    await prisma.assignmentRecord.create({
      data: {
        leadId: lead.id,
        toUserId: a.id,
        mode: "MANUAL",
        responseDueAt: instantFromEpochMs(NOON.getTime() + MINUTE),
      },
    });
    return { a, lead };
  }

  it("counts their open leads for the warning", async () => {
    const { a } = await setUp();
    const admin = await makeUser("ADMIN");
    expect(await service.openLeadCount(await contextOf("ADMIN", admin.id), a.id)).toEqual({
      openLeads: 1,
    });
  });

  it("moves them to the queue, and cancels their timers", async () => {
    const { a, lead } = await setUp();
    await adminDeactivating(a.id, { openLeads: "queue" });
    expect(await ownerOf(lead.id)).toBeNull();
    expect((await prisma.identityUser.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "DEACTIVATED",
    );
    expect(await prisma.assignmentRecord.count({ where: { responseDueAt: { not: null } } })).toBe(
      0,
    );
    // Their follow-ups go to whoever gets the lead next.
    const next = await agentOf();
    await assign(manager, [lead.id], [next.id], "MANUAL");
    expect((await prisma.leadsTask.findFirstOrThrow()).assigneeUserId).toBe(next.id);
  });

  it("gives them, with their follow-ups, to one agent", async () => {
    const { a, lead } = await setUp();
    const b = await agentOf();
    await adminDeactivating(a.id, { openLeads: "agent", toUserId: b.id });
    expect(await ownerOf(lead.id)).toBe(b.id);
    expect((await prisma.leadsTask.findFirstOrThrow()).assigneeUserId).toBe(b.id);
  });

  it("leaves them with the person, with no timer running", async () => {
    const { a, lead } = await setUp();
    await adminDeactivating(a.id, { openLeads: "keep" });
    expect(await ownerOf(lead.id)).toBe(a.id);
    expect(await prisma.assignmentRecord.count({ where: { responseDueAt: { not: null } } })).toBe(
      0,
    );
  });

  it("does nothing at all when the new owner is unsuitable", async () => {
    const { a, lead } = await setUp();
    const gone = await makeUser("AGENT", { status: "DEACTIVATED" });
    const error = await failure(adminDeactivating(a.id, { openLeads: "agent", toUserId: gone.id }));
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(await ownerOf(lead.id)).toBe(a.id);
    expect((await prisma.identityUser.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "ACTIVE",
    );
  });
});

describe("auto-assign (P5-REASSIGN-07)", () => {
  it("applies to new leads once and never overrides a manager", async () => {
    const a = await agentOf();
    const admin = await contextOf("ADMIN", (await makeUser("ADMIN")).id);
    const before = await makeLead({ ageMinutes: 60 });
    await service.setAutoRule(admin, { enabled: true, mode: "LEAST_LOADED" });
    clock.advance(MINUTE);

    const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
    const contact = await prisma.leadsContact.create({ data: { phoneE164: "+919800000001" } });
    const fresh = await prisma.leadsLead.create({
      data: { contactId: contact.id, stageId: stage.id, createdAt: clock.now() },
    });
    clock.advance(MINUTE);
    await service.sweep();
    expect(await ownerOf(fresh.id)).toBe(a.id);
    expect(await ownerOf(before.id)).toBeNull();

    // A manager takes it back to the queue through a timeout; auto-assign leaves it alone.
    clock.advance(30 * MINUTE);
    await service.sweep();
    expect(await ownerOf(fresh.id)).toBeNull();
    clock.advance(MINUTE);
    await service.sweep();
    expect(await ownerOf(fresh.id)).toBeNull();
    expect(await prisma.assignmentRecord.count({ where: { leadId: fresh.id } })).toBe(1);
  });

  it("doesn't pick up a lead again that came back to the queue moments later", async () => {
    const a = await agentOf();
    const admin = await contextOf("ADMIN", (await makeUser("ADMIN")).id);
    await service.setAutoRule(admin, { enabled: true, mode: "LEAST_LOADED" });
    const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
    const contact = await prisma.leadsContact.create({ data: { phoneE164: "+919800000002" } });
    const fresh = await prisma.leadsLead.create({
      data: { contactId: contact.id, stageId: stage.id, createdAt: clock.now() },
    });
    await service.sweep();
    expect(await ownerOf(fresh.id)).toBe(a.id);
    await prisma.leadsLead.update({ where: { id: fresh.id }, data: { ownerUserId: null } });
    clock.advance(1000);
    await service.sweep();
    expect(await ownerOf(fresh.id)).toBeNull();
  });

  it("has at most one active rule, and refuses modes that need a person", async () => {
    const admin = await contextOf("ADMIN", (await makeUser("ADMIN")).id);
    await service.setAutoRule(admin, { enabled: true, mode: "RANDOM" });
    await service.setAutoRule(admin, { enabled: true, mode: "PRIORITY", priorityBy: "value" });
    expect(await prisma.assignmentRule.count({ where: { isActive: true } })).toBe(1);
    expect(await service.getAutoRule(admin)).toMatchObject({ enabled: true, mode: "PRIORITY" });
    await service.setAutoRule(admin, { enabled: false, mode: "PRIORITY" });
    expect(await prisma.assignmentRule.count({ where: { isActive: true } })).toBe(0);
  });
});
