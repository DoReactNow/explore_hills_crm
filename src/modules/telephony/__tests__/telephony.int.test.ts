// Phase 7: placing calls, webhooks, inbound routing, outcomes and recordings, on the fake provider
// with real Postgres, real storage and real ffmpeg.
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { createFileStorage, type FileStorage } from "@/shared/storage";
import { createTestClock, instantFromEpochMs, parseBusinessLocalDateTime } from "@/shared/time";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { fakeProvider, fakeTelephony, signFakeCall } from "../providers/fake/server";
import { decryptSecret } from "../telephony.crypto";
import { createTelephonyService } from "../telephony.service";

const prisma = getPrisma();
// A Monday, inside the default working hours.
const NOON = parseBusinessLocalDateTime("2026-11-02", "12:00");
const MINUTE = 60_000;
let clock: ReturnType<typeof createTestClock>;
let service: ReturnType<typeof createTelephonyService>;
let storage: FileStorage;
let counter = 0;

async function makeUser(roleCode = "AGENT", managerId?: string, phoneE164?: string) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: `${roleCode} ${++counter}`,
      passwordHash: "h",
      status: "ACTIVE",
      roleId: role.id,
      managerId,
      phoneE164,
    },
  });
}
const nextPhone = () => `+9198${String(50000000 + ++counter)}`;
const ctx = async (id: string, role = "AGENT") => ({
  principal: await testPrincipal(role, id),
  requestId: "req",
});
async function makeLead(ownerUserId?: string, phone = nextPhone()) {
  const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
  const contact = await prisma.leadsContact.create({ data: { phoneE164: phone, name: "Asha" } });
  return prisma.leadsLead.create({
    data: { contactId: contact.id, stageId: stage.id, ownerUserId },
    include: { contact: true },
  });
}
const failure = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
};
const start = (
  context: Awaited<ReturnType<typeof ctx>>,
  leadId: string,
  channel: "BROWSER" | "PHONE" = "BROWSER",
) => service.startCall(context, leadId, { clientRef: randomUUID(), channel });

/** Delivers signed events and processes each, as the job would. */
async function deliver(...events: Array<Record<string, unknown>>) {
  const raw = JSON.stringify({ events });
  const status = await service.handleWebhook(
    raw,
    new Headers({ "x-fake-signature": signFakeCall(raw) }),
  );
  expect(status).toBe(200);
  for (const event of events) {
    const row = await prisma.telephonyWebhookEvent.findFirstOrThrow({
      where: { eventKey: String(event.id) },
    });
    await service.processEvent(row.id);
  }
}
const statusEvent = (callRef: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  callId: `p-${callRef}`,
  ref: callRef,
  status,
  at: clock.now().toISOString(),
  ...extra,
});
const callOf = (id: string) => prisma.telephonyCall.findUniqueOrThrow({ where: { id } });
async function inbound(from: string | null, callId = randomUUID()) {
  const raw = JSON.stringify({ callId, from });
  const response = await service.routeInbound(
    raw,
    new Headers({ "x-fake-signature": signFakeCall(raw) }),
  );
  return { callId, status: response.status, decision: await response.json() };
}
const online = (userId: string) =>
  prisma.telephonyAgentEndpoint.upsert({
    where: { providerKey_userId: { providerKey: "fake", userId } },
    create: { providerKey: "fake", userId, lastSeenAt: clock.now() },
    update: { lastSeenAt: clock.now() },
  });

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
  fakeTelephony.reset();
  clock = createTestClock(NOON.toISOString());
  storage = createFileStorage({
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), "calls-")),
  });
  service = createTelephonyService({
    clock,
    enqueue: false,
    provider: () => fakeProvider,
    storage: () => storage,
  });
});
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("placing a call", () => {
  it("makes one record for a double click (P7-CALL-01)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const context = await ctx(agent.id);
    const clientRef = randomUUID();
    const [one, two] = await Promise.all([
      service.startCall(context, lead.id, { clientRef, channel: "BROWSER" }),
      service.startCall(context, lead.id, { clientRef, channel: "BROWSER" }),
    ]);
    expect(one.id).toBe(two.id);
    expect(await prisma.telephonyCall.count()).toBe(1);
  });

  it("refuses a second call for the agent, or for the customer (P7-CALL-02)", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const [first, second] = [await makeLead(a.id), await makeLead(a.id)];
    await start(await ctx(a.id), first.id);
    expect((await failure(start(await ctx(a.id), second.id))).code).toBe("CONFLICT");
    const admin = await makeUser("ADMIN");
    expect((await failure(start(await ctx(admin.id, "ADMIN"), first.id))).code).toBe("CONFLICT");
    expect(b.id).toBeTruthy();
  });

  it("refuses out of scope, or without the permission (P7-CALL-03)", async () => {
    const [mine, other] = [await makeUser(), await makeUser()];
    const lead = await makeLead(other.id);
    expect((await failure(start(await ctx(mine.id), lead.id))).code).toBe("NOT_FOUND");
    expect(await prisma.telephonyCall.count()).toBe(0);
    const viewerRole = await prisma.identityRole.create({
      data: { code: "NO_CALLS", name: "No calls", description: "", isSystem: false },
    });
    const viewer = await prisma.identityUser.create({
      data: {
        email: `${randomUUID()}@example.com`,
        name: "V",
        passwordHash: "h",
        status: "ACTIVE",
        roleId: viewerRole.id,
      },
    });
    expect((await failure(start(await ctx(viewer.id, "NO_CALLS"), lead.id))).code).toBe(
      "FORBIDDEN",
    );
    expect((await failure(service.softphone(await ctx(viewer.id, "NO_CALLS")))).code).toBe(
      "FORBIDDEN",
    );
  });

  it("refuses an anonymised number (P7-CALL-04)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    await prisma.leadsContact.update({
      where: { id: lead.contactId },
      data: { anonymisedAt: NOON },
    });
    expect((await failure(start(await ctx(agent.id), lead.id))).code).toBe("VALIDATION_FAILED");
  });

  it("gives each agent their own short-lived credential, and never logs it (P7-CALL-06)", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const one = await service.softphone(await ctx(a.id));
    const two = await service.softphone(await ctx(b.id));
    expect(one.credentials?.token).not.toBe(two.credentials?.token);
    expect(one.credentials!.expiresAt.getTime()).toBeLessThanOrEqual(NOON.getTime() + 60 * MINUTE);
    expect(one.credentials!.token).toContain(a.id);
  });

  it("ends as failed, not stuck, when the provider is unreachable (P7-CALL-09)", async () => {
    const agent = await makeUser("AGENT", undefined, "+919811111111");
    const lead = await makeLead(agent.id);
    fakeTelephony.behaviour.placeCallFails = true;
    expect((await failure(start(await ctx(agent.id), lead.id, "PHONE"))).code).toBe("CONFLICT");
    expect((await prisma.telephonyCall.findFirstOrThrow()).status).toBe("FAILED");
  });

  it("says so when 'call via my phone' has no number (P7-CALL-08)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    expect((await failure(start(await ctx(agent.id), lead.id, "PHONE"))).code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("records giving up before connecting as cancelled (P7-CALL-10)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const context = await ctx(agent.id);
    const call = await start(context, lead.id);
    await service.endCall(context, call.id, { reason: "cancelled" });
    expect((await callOf(call.id)).status).toBe("CANCELLED");
  });

  it.each([
    ["busy", "BUSY"],
    ["no-answer", "NO_ANSWER"],
    ["rejected", "FAILED"],
    ["failed", "FAILED"],
  ])("a provider's %s ends as %s (P7-CALL-11)", async (raw, expected) => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const call = await start(await ctx(agent.id), lead.id);
    await deliver(statusEvent(call.callRef, raw));
    expect((await callOf(call.id)).status).toBe(expected);
  });

  it("counts as a response, so the lead's timeout is cancelled", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    await start(await ctx(agent.id), lead.id);
    const entry = await prisma.leadsTimelineEntry.findFirstOrThrow({
      where: { leadId: lead.id, kind: "CALL" },
    });
    expect(entry.actorUserId).toBe(agent.id);
  });
});

describe("during a call", () => {
  it("doesn't cut a call when the lead is reassigned or the agent deactivated (P7-CALLLIVE-06)", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const lead = await makeLead(a.id);
    const call = await start(await ctx(a.id), lead.id);
    await deliver(statusEvent(call.callRef, "answered"));
    await prisma.leadsLead.update({ where: { id: lead.id }, data: { ownerUserId: b.id } });
    await prisma.identityUser.update({ where: { id: a.id }, data: { status: "DEACTIVATED" } });
    clock.advance(MINUTE);
    await deliver(statusEvent(call.callRef, "completed", { duration: 60 }));
    expect(await callOf(call.id)).toMatchObject({
      status: "COMPLETED",
      agentUserId: a.id,
      durationSeconds: 60,
    });
  });

  it("closes a call with no end event, with a clear status (P7-CALLLIVE-04, -07)", async () => {
    const agent = await makeUser();
    const [ringing, talking] = [await makeLead(agent.id), await makeLead()];
    const call = await start(await ctx(agent.id), ringing.id);
    const admin = await makeUser("ADMIN");
    const long = await start(await ctx(admin.id, "ADMIN"), talking.id);
    await deliver(statusEvent(long.callRef, "answered"));

    clock.advance(5 * MINUTE - 1);
    await service.sweep();
    expect((await callOf(call.id)).status).toBe("INITIATED");
    clock.advance(1 + 1);
    await service.sweep();
    expect(await callOf(call.id)).toMatchObject({
      status: "FAILED",
      routingNote: "closed: no end event arrived",
    });
    expect((await callOf(long.id)).status).toBe("ANSWERED");
    clock.advance(6 * 60 * MINUTE);
    await service.sweep();
    expect((await callOf(long.id)).status).toBe("FAILED");
  });
});

describe("provider webhooks", () => {
  it("refuses a bad signature, and stores a valid event raw (P7-CALLHOOK-01)", async () => {
    const raw = JSON.stringify({ events: [statusEvent("r", "ringing")] });
    expect(await service.handleWebhook(raw, new Headers({ "x-fake-signature": "nope" }))).toBe(401);
    expect(await prisma.telephonyWebhookEvent.count()).toBe(0);
    expect(
      await service.handleWebhook(raw, new Headers({ "x-fake-signature": signFakeCall(raw) })),
    ).toBe(200);
    expect(await prisma.telephonyWebhookEvent.count()).toBe(1);
  });

  it("does nothing more for the same event twice (P7-CALLHOOK-02)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const call = await start(await ctx(agent.id), lead.id);
    const event = statusEvent(call.callRef, "completed", { duration: 10 });
    await deliver(event);
    await deliver(event);
    expect(await prisma.telephonyWebhookEvent.count()).toBe(1);
    expect(
      await prisma.leadsTimelineEntry.count({ where: { leadId: lead.id, refType: "call_end" } }),
    ).toBe(1);
  });

  it("leaves an event already processed untouched", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const call = await start(await ctx(agent.id), lead.id);
    await deliver(statusEvent(call.callRef, "ringing"));
    const row = await prisma.telephonyWebhookEvent.findFirstOrThrow();
    clock.advance(MINUTE);
    await service.processEvent(row.id);
    const again = await prisma.telephonyWebhookEvent.findFirstOrThrow();
    expect(again.processedAt).toEqual(row.processedAt);
  });

  it("never moves backward, and durations come out right out of order (P7-CALLHOOK-03)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const call = await start(await ctx(agent.id), lead.id);
    const answeredAt = clock.now().toISOString();
    clock.advance(90_000);
    await deliver(statusEvent(call.callRef, "completed"));
    await deliver(statusEvent(call.callRef, "answered", { at: answeredAt }));
    await deliver(statusEvent(call.callRef, "ringing"));
    expect(await callOf(call.id)).toMatchObject({ status: "COMPLETED", durationSeconds: 90 });
  });

  it("matches by reference first, then phone; nothing matched is logged safely (P7-CALLHOOK-04)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const other = await makeLead(agent.id);
    const call = await start(await ctx(agent.id), lead.id);
    await deliver({
      id: "by-phone",
      callId: "p-x",
      status: "ringing",
      phone: lead.contact.phoneE164,
      at: clock.now().toISOString(),
    });
    expect(await callOf(call.id)).toMatchObject({
      status: "RINGING_CUSTOMER",
      providerCallId: "p-x",
    });

    await deliver({
      id: "nobody",
      callId: "p-y",
      status: "ringing",
      phone: other.contact.phoneE164,
      at: clock.now().toISOString(),
    });
    const row = await prisma.telephonyWebhookEvent.findFirstOrThrow({
      where: { eventKey: "nobody" },
    });
    expect(row.error).toBe("no matching call");
    expect(await prisma.telephonyCall.count()).toBe(1);
  });

  it("logs an unknown status and leaves the call alone (P7-CALLHOOK-06)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const call = await start(await ctx(agent.id), lead.id);
    await deliver(statusEvent(call.callRef, "on-the-moon"));
    expect((await callOf(call.id)).status).toBe("INITIATED");
  });
});

describe("inbound calls", () => {
  it("rings the owner of a known customer when online (P7-INCALL-01)", async () => {
    const owner = await makeUser();
    await online(owner.id);
    const lead = await makeLead(owner.id);
    const { decision } = await inbound(lead.contact.phoneE164);
    expect(decision).toMatchObject({ action: "ring", agentUserId: owner.id });
    expect(decision.announcement).toContain("recorded");
    expect(decision.announcement).toContain("रिकॉर्ड");
  });

  it("falls back when the owner is offline, busy or on leave (P7-INCALL-02)", async () => {
    const [owner, spare] = [await makeUser(), await makeUser()];
    await online(spare.id);
    const lead = await makeLead(owner.id);
    expect((await inbound(lead.contact.phoneE164)).decision).toMatchObject({
      agentUserId: spare.id,
    });

    await online(owner.id);
    await prisma.assignmentAgentSetting.create({
      data: {
        userId: owner.id,
        leaveFromDate: instantFromEpochMs(Date.UTC(2026, 10, 1)),
        leaveToDate: instantFromEpochMs(Date.UTC(2026, 10, 3)),
      },
    });
    const other = await makeLead(owner.id);
    await prisma.telephonyCall.updateMany({ data: { status: "COMPLETED" } });
    expect((await inbound(other.contact.phoneE164)).decision).toMatchObject({
      agentUserId: spare.id,
    });
  });

  it("the manager rule rings the owner's manager", async () => {
    await prisma.systemSetting.create({
      data: { key: "telephony.inboundFallback", value: "manager" },
    });
    const manager = await makeUser("MANAGER");
    const owner = await makeUser("AGENT", manager.id);
    await online(manager.id);
    const lead = await makeLead(owner.id);
    expect((await inbound(lead.contact.phoneE164)).decision).toMatchObject({
      agentUserId: manager.id,
    });
  });

  it("takes a message and logs a missed call with nobody available (P7-INCALL-02)", async () => {
    const owner = await makeUser();
    const lead = await makeLead(owner.id);
    const { callId, decision } = await inbound(lead.contact.phoneE164);
    expect(decision.action).toBe("voicemail");
    await deliver({ id: "end", callId, status: "completed", at: clock.now().toISOString() });
    expect(
      await prisma.leadsTimelineEntry.count({ where: { leadId: lead.id, summary: "Missed call" } }),
    ).toBe(1);
    const task = await prisma.leadsTask.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(task.assigneeUserId).toBe(owner.id);
  });

  it("makes one Phone lead for an unknown number, even with two calls together (P7-INCALL-03)", async () => {
    const phone = nextPhone();
    await Promise.all([inbound(phone), inbound(phone)]);
    const leads = await prisma.leadsLead.findMany({ where: { contact: { phoneE164: phone } } });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ source: "PHONE", ownerUserId: null });
  });

  it("lets only one answer (P7-INCALL-04)", async () => {
    const agent = await makeUser();
    await online(agent.id);
    const lead = await makeLead(agent.id);
    await inbound(lead.contact.phoneE164);
    const call = await prisma.telephonyCall.findFirstOrThrow();
    const context = await ctx(agent.id);
    const results = await Promise.allSettled([
      service.answer(context, call.id),
      service.answer(context, call.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const other = await makeUser();
    const late = await failure(service.answer(await ctx(other.id), call.id));
    expect(late.fieldErrors?.[0].message).toMatch(/already been answered/);
  });

  it("logs a missed call when the caller hangs up or the agent declines (P7-INCALL-05, -06)", async () => {
    const agent = await makeUser();
    await online(agent.id);
    const lead = await makeLead(agent.id);
    await inbound(lead.contact.phoneE164);
    const call = await prisma.telephonyCall.findFirstOrThrow();
    await service.decline(await ctx(agent.id), call.id);
    expect((await callOf(call.id)).status).toBe("NO_ANSWER");
    expect(
      await prisma.leadsTimelineEntry.count({ where: { leadId: lead.id, summary: "Missed call" } }),
    ).toBe(1);
  });

  it("can't be answered once it has ended, and a missed call is nobody's response", async () => {
    const agent = await makeUser();
    await online(agent.id);
    const lead = await makeLead(agent.id);
    await inbound(lead.contact.phoneE164);
    const call = await prisma.telephonyCall.findFirstOrThrow();
    const context = await ctx(agent.id);
    await service.decline(context, call.id);
    expect((await failure(service.answer(context, call.id))).code).toBe("CONFLICT");
    const entry = await prisma.leadsTimelineEntry.findFirstOrThrow({
      where: { leadId: lead.id, summary: "Missed call" },
    });
    expect(entry.actorUserId).toBeNull();
  });

  it("doesn't ring an agent already on a call (P7-INCALL-06)", async () => {
    const agent = await makeUser();
    await online(agent.id);
    const lead = await makeLead(agent.id);
    await start(await ctx(agent.id), lead.id);
    const other = await makeLead(agent.id);
    expect((await inbound(other.contact.phoneE164)).decision.action).toBe("voicemail");
  });

  it.each([[null], ["garbage"]])(
    "handles a hidden or malformed number %s safely (P7-INCALL-07)",
    async (from) => {
      const { decision } = await inbound(from);
      expect(decision.action).toBe("voicemail");
      expect(await prisma.leadsLead.count()).toBe(0);
      expect((await prisma.telephonyCall.findFirstOrThrow()).customerPhoneE164).toBe("hidden");
    },
  );

  it("answers in time when routing is slow (P7-INCALL-09)", async () => {
    const agent = await makeUser();
    await online(agent.id);
    const lead = await makeLead(agent.id);
    let release = () => {};
    const slow = createTelephonyService({
      clock,
      enqueue: false,
      provider: () => fakeProvider,
      storage: () => storage,
      routingLimitMs: 20,
      beforeRoutingForTests: () => new Promise((resolve) => (release = resolve)),
    });
    const raw = JSON.stringify({ callId: "slow", from: lead.contact.phoneE164 });
    const response = await slow.routeInbound(
      raw,
      new Headers({ "x-fake-signature": signFakeCall(raw) }),
    );
    expect((await response.json()).action).toBe("voicemail");
    release();
    await vi.waitFor(async () =>
      expect((await prisma.telephonyCall.findFirstOrThrow()).status).toBe("NO_ANSWER"),
    );
  });

  describe("out of hours (Q-13)", () => {
    it("asks the caller to leave a message, in both languages, and rings nobody", async () => {
      clock.set(parseBusinessLocalDateTime("2026-11-02", "19:00"));
      const owner = await makeUser();
      await online(owner.id);
      const lead = await makeLead(owner.id);
      const { decision } = await inbound(lead.contact.phoneE164);
      expect(decision.action).toBe("voicemail");
      expect(decision.prompt).toContain("leave a message");
      expect(decision.prompt).toContain("बीप");
      expect(decision.prompt).not.toContain("{company}");
    });

    it("treats a closed day the same, and the start minute as open", async () => {
      const owner = await makeUser();
      await online(owner.id);
      const lead = await makeLead(owner.id);
      clock.set(parseBusinessLocalDateTime("2026-11-01", "12:00")); // Sunday
      await online(owner.id);
      expect((await inbound(lead.contact.phoneE164)).decision.action).toBe("voicemail");
      await prisma.telephonyCall.updateMany({ data: { status: "COMPLETED" } });
      clock.set(parseBusinessLocalDateTime("2026-11-02", "10:00"));
      await online(owner.id);
      expect((await inbound(lead.contact.phoneE164)).decision.action).toBe("ring");
    });

    it("keeps the left message on the call", async () => {
      clock.set(parseBusinessLocalDateTime("2026-11-02", "22:00"));
      const lead = await makeLead();
      const { callId } = await inbound(lead.contact.phoneE164);
      await deliver({ id: "vm", callId, recording: "vm-1", at: clock.now().toISOString() });
      const call = await prisma.telephonyCall.findFirstOrThrow();
      await service.storeRecording(call.id, false);
      expect((await prisma.telephonyRecording.findFirstOrThrow()).status).toBe("STORED");
    });
  });
});

describe("the call outcome (P6-WORK-08)", () => {
  async function ended() {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const context = await ctx(agent.id);
    const call = await start(context, lead.id);
    await deliver(statusEvent(call.callRef, "completed", { duration: 30 }));
    return { agent, lead, context, call };
  }

  it("needs the call to have ended", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const context = await ctx(agent.id);
    const call = await start(context, lead.id);
    expect(
      (await failure(service.saveOutcome(context, call.id, { outcome: "INTERESTED" }))).code,
    ).toBe("CONFLICT");
  });

  it("can't be submitted twice, and the same answer again is harmless", async () => {
    const { context, call, lead } = await ended();
    const results = await Promise.all([
      service.saveOutcome(context, call.id, { outcome: "INTERESTED", notes: "Likes it" }),
      service.saveOutcome(context, call.id, { outcome: "INTERESTED", notes: "Likes it" }),
    ]);
    expect(results[0].outcomeCode).toBe("INTERESTED");
    expect(
      await prisma.leadsTimelineEntry.count({
        where: { leadId: lead.id, refType: "call_outcome" },
      }),
    ).toBe(1);
    expect((await failure(service.saveOutcome(context, call.id, { outcome: "BUSY" }))).code).toBe(
      "CONFLICT",
    );
  });

  it("can be filled in later, and adds the follow-up", async () => {
    const { context, call, lead } = await ended();
    clock.advance(3 * 24 * 60 * MINUTE);
    await service.saveOutcome(context, call.id, {
      outcome: "CALL_BACK",
      followUpDate: "2099-01-01",
    });
    expect((await callOf(call.id)).outcomeCode).toBe("CALL_BACK");
    expect(await prisma.leadsTask.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("lets only one of two different answers win", async () => {
    const { context, call } = await ended();
    const results = await Promise.allSettled([
      service.saveOutcome(context, call.id, { outcome: "INTERESTED" }),
      service.saveOutcome(context, call.id, { outcome: "BUSY" }),
    ]);
    const won = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.outcomeCode] : []));
    expect(won).toHaveLength(1);
    expect((await callOf(call.id)).outcomeCode).toBe(won[0]);
    expect(await prisma.auditEvent.count({ where: { action: "telephony.outcome_saved" } })).toBe(1);
  });

  it("is refused for someone else's call", async () => {
    const { call } = await ended();
    const stranger = await makeUser();
    expect(
      (await failure(service.saveOutcome(await ctx(stranger.id), call.id, { outcome: "BUSY" })))
        .code,
    ).toBe("NOT_FOUND");
  });
});

describe("recordings", () => {
  async function withRecording(ref = "rec-1") {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const call = await start(await ctx(agent.id), lead.id);
    await deliver(statusEvent(call.callRef, "completed", { duration: 5 }));
    await deliver({
      id: randomUUID(),
      callId: `p-${call.callRef}`,
      ref: call.callRef,
      recording: ref,
      at: clock.now().toISOString(),
    });
    return { agent, lead, call };
  }
  const recordingOf = (callId: string) =>
    prisma.telephonyRecording.findUniqueOrThrow({ where: { callId } });

  it("stores a compressed file and only metadata (P7-REC-01, -16)", async () => {
    const { call } = await withRecording();
    await service.storeRecording(call.id, false);
    const row = await recordingOf(call.id);
    expect(row).toMatchObject({ status: "STORED", contentType: "audio/mpeg", attempts: 1 });
    expect(row.storageKey).toMatch(/^recordings\/2026\/11\/.+\.mp3$/);
    expect(row.storageKey).not.toContain("+91");
    expect(row.checksumSha256).toHaveLength(64);
    expect(await storage.exists(row.storageKey as string)).toBe(true);
    expect(row.expiresAt).toEqual(instantFromEpochMs(NOON.getTime() + 90 * 24 * 60 * MINUTE));
  });

  it("stores once for 'ready' twice (P7-REC-02)", async () => {
    const { call } = await withRecording();
    await service.storeRecording(call.id, false);
    await service.storeRecording(call.id, false);
    expect((await recordingOf(call.id)).attempts).toBe(1);
  });

  it("marks an expired link failed, and leaves the call log alone (P7-REC-03)", async () => {
    fakeTelephony.behaviour.recordings.set("gone", "expired");
    const { call } = await withRecording("gone");
    const before = await callOf(call.id);
    await service.storeRecording(call.id, false);
    expect((await recordingOf(call.id)).status).toBe("FAILED");
    expect((await callOf(call.id)).status).toBe(before.status);
  });

  it("retries a failed download, then fails clearly (P7-REC-04, -15)", async () => {
    fakeTelephony.behaviour.recordings.set("flaky", "unreachable");
    const { call } = await withRecording("flaky");
    await expect(service.storeRecording(call.id, false)).rejects.toThrow("unreachable");
    expect((await recordingOf(call.id)).status).toBe("PENDING");
    await service.storeRecording(call.id, true);
    expect((await recordingOf(call.id)).status).toBe("FAILED");
  });

  it.each([
    ["corrupt", Buffer.from("not audio")],
    ["empty", Buffer.alloc(0)],
  ])("fails a %s recording clearly, with no file (P7-REC-05)", async (name, bytes) => {
    fakeTelephony.behaviour.recordings.set(name, bytes);
    const { call } = await withRecording(name);
    await service.storeRecording(call.id, false);
    const row = await recordingOf(call.id);
    expect(row.status).toBe("FAILED");
    expect(row.storageKey).toBeNull();
  });

  it("treats a checksum mismatch as a failure, leaving no file (P7-REC-06)", async () => {
    const { call } = await withRecording();
    const put = storage.put.bind(storage);
    let key = "";
    storage.put = async (k, body, type) => {
      key = k;
      const file = await put(k, body, type);
      return { ...file, checksumSha256: "0".repeat(64) };
    };
    await expect(service.storeRecording(call.id, false)).rejects.toThrow("match");
    expect(await storage.exists(key)).toBe(false);
    expect((await recordingOf(call.id)).status).toBe("PENDING");
  });

  it("can run again after a crash mid-job (P7-REC-07)", async () => {
    const { call } = await withRecording();
    await prisma.telephonyRecording.update({
      where: { callId: call.id },
      data: { status: "DOWNLOADING" },
    });
    await prisma.$executeRaw`UPDATE telephony_recordings SET "updatedAt" = ${NOON}::timestamptz`;
    await service.storeRecording(call.id, false);
    expect((await recordingOf(call.id)).status).toBe("DOWNLOADING"); // still held by the other run
    await prisma.$executeRaw`UPDATE telephony_recordings SET "updatedAt" = '2020-01-01'`;
    await service.storeRecording(call.id, false);
    expect((await recordingOf(call.id)).status).toBe("STORED");
  });

  it("shows no recording state for a call without one (P7-REC-08)", async () => {
    const agent = await makeUser();
    const lead = await makeLead(agent.id);
    const context = await ctx(agent.id);
    const call = await start(context, lead.id);
    expect(await service.getCall(context, call.id)).toMatchObject({
      recordingState: null,
      canPlay: false,
    });
  });

  describe("playback", () => {
    async function stored() {
      const manager = await makeUser("MANAGER");
      const agent = await makeUser("AGENT", manager.id);
      const lead = await makeLead(agent.id);
      const call = await start(await ctx(agent.id), lead.id);
      await deliver(statusEvent(call.callRef, "completed", { duration: 5 }));
      await deliver({
        id: randomUUID(),
        callId: `p-${call.callRef}`,
        ref: call.callRef,
        recording: "r",
        at: clock.now().toISOString(),
      });
      await service.storeRecording(call.id, false);
      return { manager, agent, lead, call };
    }

    it("needs the permission and the scope (P7-REC-09, -11)", async () => {
      const { manager, agent, call } = await stored();
      expect((await failure(service.playRecording(await ctx(agent.id), call.id, null))).code).toBe(
        "FORBIDDEN",
      );
      const elsewhere = await makeUser("MANAGER");
      expect(
        (await failure(service.playRecording(await ctx(elsewhere.id, "MANAGER"), call.id, null)))
          .code,
      ).toBe("NOT_FOUND");
      const allowed = await service.playRecording(await ctx(manager.id, "MANAGER"), call.id, null);
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("content-type")).toBe("audio/mpeg");
      expect(allowed.headers.get("cache-control")).toContain("no-store");
    });

    it("won't retry a recording without the permission", async () => {
      const { agent, call } = await stored();
      expect((await failure(service.retryRecording(await ctx(agent.id), call.id))).code).toBe(
        "FORBIDDEN",
      );
    });

    it("audits a playback once, not each seek (P7-REC-11)", async () => {
      const { manager, call } = await stored();
      const context = await ctx(manager.id, "MANAGER");
      await service.playRecording(context, call.id, "bytes=0-");
      await service.playRecording(context, call.id, "bytes=100-");
      expect(
        await prisma.auditEvent.count({ where: { action: "telephony.recording_played" } }),
      ).toBe(1);
    });

    it("streams ranges, so seeking works (P7-REC-12)", async () => {
      const { manager, call } = await stored();
      const context = await ctx(manager.id, "MANAGER");
      const whole = await service.playRecording(context, call.id, null);
      const size = (await whole.arrayBuffer()).byteLength;
      const part = await service.playRecording(context, call.id, "bytes=10-19");
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe(`bytes 10-19/${size}`);
      expect((await part.arrayBuffer()).byteLength).toBe(10);
      expect((await service.playRecording(context, call.id, `bytes=${size + 5}-`)).status).toBe(
        416,
      );
    });

    it("sends a short-lived link where the driver signs one (P7-REC-10)", async () => {
      const { manager, call } = await stored();
      const signed = vi
        .spyOn(storage, "getTemporaryUrl")
        .mockResolvedValue("https://files.example/x?sig=1");
      const response = await service.playRecording(await ctx(manager.id, "MANAGER"), call.id, null);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("sig=1");
      expect(signed.mock.calls[0][1]).toBeLessThanOrEqual(300);
    });

    it("says 'no longer available' after retention, and the log stays (P7-REC-13, -14)", async () => {
      const { manager, call } = await stored();
      const key = (await recordingOf(call.id)).storageKey as string;
      clock.advance(90 * 24 * 60 * MINUTE - 1);
      expect(await service.deleteExpiredRecordings()).toBe(0);
      clock.advance(1);
      // A file already gone is not an error.
      await storage.delete(key);
      expect(await service.deleteExpiredRecordings()).toBe(1);
      expect(await service.deleteExpiredRecordings()).toBe(0);
      expect(await recordingOf(call.id)).toMatchObject({ status: "DELETED", storageKey: null });
      expect((await callOf(call.id)).status).toBe("COMPLETED");
      const context = await ctx(manager.id, "MANAGER");
      expect((await service.getCall(context, call.id)).recordingState).toBe("DELETED");
      expect((await failure(service.playRecording(context, call.id, null))).code).toBe("NOT_FOUND");
    });
  });
});

describe("logins and the log", () => {
  it("stores a login encrypted, and never returns it (P7-DRIVER-04)", async () => {
    const [admin, agent] = [await makeUser("ADMIN"), await makeUser()];
    const result = await service.saveEndpoint(await ctx(admin.id, "ADMIN"), agent.id, {
      login: "sip-user",
      secret: "sip-pass",
    });
    expect(JSON.stringify(result)).not.toContain("sip-");
    const row = await prisma.telephonyAgentEndpoint.findFirstOrThrow();
    expect(row.loginEncrypted).not.toContain("sip-user");
    expect(row.secretEncrypted).not.toContain("sip-pass");
    expect(decryptSecret(row.secretEncrypted as string)).toBe("sip-pass");
  });

  it("lists missed calls for a manager, only in their branch", async () => {
    const manager = await makeUser("MANAGER");
    const agent = await makeUser("AGENT", manager.id);
    const [mine, others] = [await makeLead(agent.id), await makeLead((await makeUser()).id)];
    for (const lead of [mine, others]) {
      const { callId } = await inbound(lead.contact.phoneE164);
      await deliver({
        id: randomUUID(),
        callId,
        status: "no-answer",
        at: clock.now().toISOString(),
      });
    }
    const context = await ctx(manager.id, "MANAGER");
    const { items } = await service.listCalls(context, { filter: "missed", page: 1 });
    expect(items.map((call) => call.leadId)).toEqual([mine.id]);
  });
});
