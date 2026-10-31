// Phase 6: the agent's quick filters and their counts (P6-WORK-01, -09).
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { getPrisma } from "@/shared/db/prisma";
import { businessDateToDbDate, createTestClock, parseBusinessLocalDateTime } from "@/shared/time";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { createLeadService, ensureDefaultStages } from "..";
import { leadChangedEvent } from "../leads.events";

const prisma = getPrisma();
const clock = createTestClock(parseBusinessLocalDateTime("2026-11-02", "12:00").toISOString());
const service = createLeadService({ clock });
let counter = 0;

async function makeAgent() {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Agent",
      passwordHash: "h",
      status: "ACTIVE",
      roleId: role.id,
    },
  });
}
async function makeLead(ownerUserId: string, followUp: string | null, stageCode = "NEW") {
  const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: stageCode } });
  const contact = await prisma.leadsContact.create({
    data: { phoneE164: `+9198${String(40000000 + ++counter)}`, name: `C${counter}` },
  });
  return prisma.leadsLead.create({
    data: {
      contactId: contact.id,
      stageId: stage.id,
      ownerUserId,
      nextFollowUpDate: followUp ? businessDateToDbDate(followUp) : null,
    },
  });
}
const list = (context: { principal: Awaited<ReturnType<typeof testPrincipal>> }, quick?: string) =>
  service.listLeads(context, {
    page: 1,
    pageSize: 50,
    sort: "createdAt",
    direction: "asc",
    ...(quick ? { quick } : {}),
  } as Parameters<typeof service.listLeads>[1]);

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
});
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("the lead-changed notice", () => {
  it("reaches only people who may see the lead", async () => {
    const [mine, other] = [await makeAgent(), await makeAgent()];
    const lead = await makeLead(mine.id, null);
    const canReceive = (principal: Awaited<ReturnType<typeof testPrincipal>>) =>
      leadChangedEvent.canReceive?.(principal, { leadId: lead.id });
    expect(await canReceive(await testPrincipal("AGENT", mine.id))).toBe(true);
    expect(await canReceive(await testPrincipal("AGENT", other.id))).toBe(false);
    await prisma.leadsLead.update({ where: { id: lead.id }, data: { deletedAt: clock.now() } });
    expect(await canReceive(await testPrincipal("AGENT", mine.id))).toBe(false);
  });
});

describe("quick filters", () => {
  it("show only the agent's own leads, and each count matches its list", async () => {
    const [me, other] = [await makeAgent(), await makeAgent()];
    const overdue = await makeLead(me.id, "2026-11-01");
    const today = await makeLead(me.id, "2026-11-02");
    const later = await makeLead(me.id, "2026-11-03");
    const none = await makeLead(me.id, null);
    await makeLead(me.id, null, "LOST");
    await makeLead(other.id, "2026-11-01");
    const context = { principal: await testPrincipal("AGENT", me.id) };

    const all = await list(context);
    expect(all.quickCounts).toEqual({ open: 4, overdue: 1, today: 1, noFollowUp: 1 });
    expect(all.total).toBe(5);

    const ids = async (quick: string) => (await list(context, quick)).items.map((l) => l.id);
    expect((await ids("open")).sort()).toEqual([overdue.id, today.id, later.id, none.id].sort());
    expect(await ids("overdue")).toEqual([overdue.id]);
    expect(await ids("today")).toEqual([today.id]);
    expect(await ids("noFollowUp")).toEqual([none.id]);
    // The counts don't change with the chosen filter.
    expect((await list(context, "today")).quickCounts).toEqual(all.quickCounts);
    expect((await list(context, "today")).total).toBe(1);
  });

  it("are all zero for an agent with no leads (P6-WORK-09)", async () => {
    const me = await makeAgent();
    const result = await list({ principal: await testPrincipal("AGENT", me.id) });
    expect(result.items).toEqual([]);
    expect(result.quickCounts).toEqual({ open: 0, overdue: 0, today: 0, noFollowUp: 0 });
  });
});
