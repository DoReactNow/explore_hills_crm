// Phase 8: the other modules really do tell people. The services run with their jobs and notices on.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAssignmentService } from "@/modules/assignment/assignment.service";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { fakeProvider, signFakeCall } from "@/modules/telephony/providers/fake/server";
import { createTelephonyService } from "@/modules/telephony/telephony.service";
import { getPrisma } from "@/shared/db/prisma";
import { startTestJobRuntime, type TestJobRuntime } from "@/shared/jobs/testing/testRuntime";
import { createTestClock, parseBusinessLocalDateTime } from "@/shared/time";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";

const prisma = getPrisma();
const NOON = parseBusinessLocalDateTime("2026-11-02", "12:00");
let runtime: TestJobRuntime;
let counter = 0;

async function makeUser(roleCode = "AGENT", managerId?: string) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: `${roleCode} ${++counter}`,
      passwordHash: "h",
      status: "ACTIVE",
      roleId: role.id,
      managerId,
    },
  });
}
async function makeLead(ownerUserId?: string) {
  const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
  const contact = await prisma.leadsContact.create({
    data: { phoneE164: `+9198${String(70000000 + ++counter)}`, name: "Asha" },
  });
  return prisma.leadsLead.create({
    data: { contactId: contact.id, stageId: stage.id, ownerUserId },
    include: { contact: true },
  });
}
const kindsOf = async (userId: string) =>
  (await prisma.notificationsNotification.findMany({ where: { userId } }))
    .map((row) => row.kind)
    .sort();

beforeAll(async () => {
  runtime = await startTestJobRuntime({ start: "2099-01-01T00:00:00Z" });
});
beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
});
afterAll(async () => {
  await runtime.stop();
  await resetDatabase();
  await prisma.$disconnect();
});

describe("assignment", () => {
  it("tells the agent of a new lead, and both people of a reassignment", async () => {
    const manager = await makeUser("MANAGER");
    const [a, b] = [await makeUser("AGENT", manager.id), await makeUser("AGENT", manager.id)];
    const lead = await makeLead();
    const service = createAssignmentService({ clock: createTestClock(NOON.toISOString()) });
    const context = { principal: await testPrincipal("MANAGER", manager.id) };
    await service.commit(context, {
      idempotencyKey: randomUUID(),
      mode: "MANUAL",
      rows: [{ leadId: lead.id, userId: a.id }],
    });
    expect(await kindsOf(a.id)).toEqual(["lead_assigned"]);
    await service.reassign(context, lead.id, { toUserId: b.id, reason: "Rebalancing" });
    expect(await kindsOf(b.id)).toEqual(["lead_reassigned"]);
    expect(await kindsOf(a.id)).toEqual(["lead_assigned", "lead_reassigned"]);
  });

  it("offers a blast to those chosen, and flags repeat timeouts to the manager", async () => {
    const manager = await makeUser("MANAGER");
    const agent = await makeUser("AGENT", manager.id);
    const [offered, missed] = [await makeLead(), await makeLead()];
    const clock = createTestClock(NOON.toISOString());
    const service = createAssignmentService({ clock });
    const context = { principal: await testPrincipal("MANAGER", manager.id) };
    await service.commit(context, {
      idempotencyKey: randomUUID(),
      mode: "BLAST",
      offers: { leadIds: [offered.id], userIds: [agent.id] },
    });
    expect(await kindsOf(agent.id)).toEqual(["blast_offer"]);
    for (let i = 0; i < 2; i += 1) {
      await service.commit(context, {
        idempotencyKey: randomUUID(),
        mode: "MANUAL",
        rows: [{ leadId: missed.id, userId: agent.id }],
      });
      clock.advance({ minutes: 31 });
      await service.sweep();
    }
    expect(await kindsOf(manager.id)).toEqual(["lead_escalated"]);
  });
});

describe("calling", () => {
  it("tells the owner, their manager and Admins of a missed call (Decision 61)", async () => {
    const admin = await makeUser("ADMIN");
    const manager = await makeUser("MANAGER");
    const owner = await makeUser("AGENT", manager.id);
    const outsider = await makeUser("MANAGER");
    const lead = await makeLead(owner.id);
    const service = createTelephonyService({
      clock: createTestClock(NOON.toISOString()),
      provider: () => fakeProvider,
    });
    const raw = JSON.stringify({ callId: "missed-1", from: lead.contact.phoneE164 });
    await service.routeInbound(raw, new Headers({ "x-fake-signature": signFakeCall(raw) }));
    const call = await prisma.telephonyCall.findFirstOrThrow();
    const event = JSON.stringify({
      events: [{ id: "e1", callId: "missed-1", status: "no-answer", at: NOON.toISOString() }],
    });
    await service.handleWebhook(event, new Headers({ "x-fake-signature": signFakeCall(event) }));
    const row = await prisma.telephonyWebhookEvent.findFirstOrThrow();
    await service.processEvent(row.id);
    expect((await prisma.telephonyCall.findUniqueOrThrow({ where: { id: call.id } })).status).toBe(
      "NO_ANSWER",
    );
    for (const person of [owner, manager, admin]) {
      expect(await kindsOf(person.id)).toEqual(["missed_call"]);
    }
    expect(await kindsOf(outsider.id)).toEqual([]);
  });
});
