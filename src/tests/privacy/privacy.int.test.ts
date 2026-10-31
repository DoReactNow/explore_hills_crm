// Phase 10: erasure, consent, holds and the customer's data export. The erasure test plants one marked
// value in every personal field, then searches every table for what's left.
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages, resolveLeadForInbound } from "@/modules/leads";
import { createTelephonyService } from "@/modules/telephony/telephony.service";
import { createFileDeletionService } from "@/modules/system/system.fileDeletion";
import { fileDeletionRepository } from "@/modules/system/system.fileDeletion.repository";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { getFileStorage } from "@/shared/storage";
import {
  businessDateToDbDate,
  createTestClock,
  parseBusinessLocalDateTime as at,
} from "@/shared/time";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { createPrivacyService } from "@/modules/privacy/privacy.service";

const prisma = getPrisma();
const NOW = at("2026-11-06", "15:00");
const service = createPrivacyService(createTestClock(NOW.toISOString()));
const PHONE = "+919812345678";
const MARK = "ZZPLANTEDZZ";
let counter = 0;

async function makeUser(roleCode = "ADMIN") {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: `${roleCode} ${++counter}`,
      passwordHash: "h",
      roleId: role.id,
    },
  });
}
const ctx = async (roleCode = "ADMIN") => {
  const user = await makeUser(roleCode);
  return { principal: await testPrincipal(roleCode, user.id) };
};
const stageId = async (code: string) =>
  (await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code } })).id;
const failure = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
};

/** A customer with something personal in every place the app keeps it, on a closed lead. */
async function fullCustomer(phone = PHONE, stage = "LOST") {
  const agent = await makeUser("AGENT");
  const contact = await prisma.leadsContact.create({
    data: { phoneE164: phone, name: `Asha ${MARK}`, email: `${MARK}@example.com` },
  });
  const lead = await prisma.leadsLead.create({
    data: {
      contactId: contact.id,
      stageId: await stageId(stage),
      ownerUserId: agent.id,
      sourceDetail: MARK,
      destination: `Manali ${MARK}`,
      travelStartDate: businessDateToDbDate("2026-12-01"),
      travelEndDate: businessDateToDbDate("2026-12-05"),
      travellerCount: 4,
      budgetAmount: 50000,
      customFields: { stay: MARK },
      lostReason: MARK,
      closedAt: NOW,
    },
  });
  await prisma.leadsNote.create({
    data: { leadId: lead.id, authorUserId: agent.id, body: MARK, createdAt: NOW },
  });
  await prisma.leadsTask.create({
    data: {
      leadId: lead.id,
      assigneeUserId: agent.id,
      title: MARK,
      dueDate: businessDateToDbDate("2026-12-01"),
    },
  });
  await prisma.leadsTimelineEntry.create({
    data: {
      leadId: lead.id,
      kind: "TASK",
      summary: `Follow-up added: ${MARK}`,
      refType: "task",
      refId: randomUUID(),
      occurredAt: NOW,
    },
  });
  await prisma.leadsTimelineEntry.create({
    data: {
      leadId: lead.id,
      kind: "CALL",
      summary: `Outcome: Interested — ${MARK}`,
      refType: "outcome",
      refId: randomUUID(),
      occurredAt: NOW,
    },
  });
  await prisma.assignmentRecord.create({
    data: {
      leadId: lead.id,
      toUserId: agent.id,
      mode: "MANUAL",
      reason: MARK,
    },
  });
  const conversation = await prisma.messagingConversation.create({
    data: {
      businessPhoneNumberId: "biz",
      waId: phone.slice(1),
      contactId: contact.id,
      leadId: lead.id,
      lastMessageAt: NOW,
    },
  });
  const mediaKey = `uploads/2026-11/${randomUUID()}.jpg`;
  await getFileStorage().put(mediaKey, Buffer.from("photo"), "image/jpeg");
  await prisma.messagingMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      type: "IMAGE",
      waMessageId: `wamid.${MARK}${phone}`,
      replyToWaId: `wamid.${MARK}`,
      clientRef: `${MARK}${phone}`,
      body: MARK,
      mediaRef: mediaKey,
      mediaStatus: "STORED",
      mediaFilename: `${MARK}.jpg`,
      templateVariables: [MARK],
      status: "RECEIVED",
      occurredAt: NOW,
    },
  });
  await prisma.messagingWebhookEvent.create({
    data: {
      eventKey: randomUUID(),
      kind: "message",
      payload: { from: phone.slice(1), text: MARK },
    },
  });
  await prisma.telephonyWebhookEvent.create({
    data: { providerKey: "fake", eventKey: randomUUID(), payload: { from: phone, note: MARK } },
  });
  const call = await prisma.telephonyCall.create({
    data: {
      providerKey: "fake",
      callRef: randomUUID(),
      leadId: lead.id,
      agentUserId: agent.id,
      customerPhoneE164: phone,
      status: "COMPLETED",
      startedAt: NOW,
      outcomeNotes: MARK,
      routingNote: MARK,
    },
  });
  const recordingKey = `recordings/2026-11/${call.id}.mp3`;
  await getFileStorage().put(recordingKey, Buffer.from("voice"), "audio/mpeg");
  await prisma.telephonyRecording.create({
    data: {
      callId: call.id,
      status: "STORED",
      storageKey: recordingKey,
      providerRecordingRef: MARK,
      expiresAt: at("2027-01-01", "12:00"),
    },
  });
  await prisma.notificationsNotification.create({
    data: {
      userId: agent.id,
      kind: "sla",
      title: "No reply yet",
      body: `${MARK} has had no reply.`,
      link: `/leads/${lead.id}`,
      dedupeKeys: [],
      createdAt: NOW,
    },
  });
  return { contact, lead, call, agent, mediaKey, recordingKey, conversation };
}

/** Every table, as text, for what's left of a value. */
async function tablesHolding(value: string): Promise<string[]> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%'`;
  const found: string[] = [];
  for (const { tablename } of tables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) FROM "${tablename}" t WHERE t::text LIKE $1`,
      `%${value}%`,
    );
    if (Number(rows[0].count) > 0) found.push(tablename);
  }
  return found;
}

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
});
afterAll(async () => {
  await resetDatabase();
});

describe("erasure", () => {
  it("leaves nothing personal in any table, and the rows stay (P10-ERASE-01, -06)", async () => {
    const { contact, lead, call, mediaKey, recordingKey, conversation } = await fullCustomer();
    const context = await ctx();
    const result = await service.erase(context, contact.id, { confirmPhone: PHONE });
    expect(result).toMatchObject({ erased: true, alreadyErased: false, filesWaiting: 0 });

    expect(await tablesHolding(MARK)).toEqual([]);
    expect(await tablesHolding(PHONE.slice(1))).toEqual([]);

    const row = await prisma.leadsContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(row).toMatchObject({ name: "Erased customer", email: null, optInStatus: "OPTED_OUT" });
    expect(row.phoneE164).toMatch(/^erased-[a-z]+$/);
    expect(row.anonymisedAt).not.toBeNull();
    // The figures in reports still hold: the lead, its stage and its value are there.
    const kept = await prisma.leadsLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(kept.budgetAmount?.toString()).toBe("50000");
    expect(kept.stageId).toBe(await stageId("LOST"));
    expect(await prisma.telephonyCall.count({ where: { id: call.id } })).toBe(1);
    expect(
      await prisma.messagingMessage.count({ where: { conversationId: conversation.id } }),
    ).toBe(1);

    expect(await getFileStorage().exists(mediaKey)).toBe(false);
    expect(await getFileStorage().exists(recordingKey)).toBe(false);
    expect(
      await prisma.telephonyRecording.findUniqueOrThrow({ where: { callId: call.id } }),
    ).toMatchObject({
      status: "DELETED",
      storageKey: null,
      providerRecordingRef: null,
    });
  });

  it("keeps the audit trail append-only, with no personal data in it (P10-ERASE-11)", async () => {
    const { contact } = await fullCustomer();
    const context = await ctx();
    await service.erase(context, contact.id, { confirmPhone: PHONE });
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: "contact.erased" } });
    expect(event).toMatchObject({ entityId: contact.id, actorUserId: context.principal.userId });
    expect(JSON.stringify(event)).not.toContain(MARK);
    await expect(
      prisma.auditEvent.update({ where: { id: event.id }, data: { summary: "changed" } }),
    ).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  it("retries a storage failure until the file has gone (P10-ERASE-02)", async () => {
    const { recordingKey } = await fullCustomer();
    let down = true;
    const deleted: string[] = [];
    const flaky = createFileDeletionService(fileDeletionRepository, () => ({
      delete: async (key: string) => {
        if (down) throw new Error("storage is down");
        deleted.push(key);
        await getFileStorage().delete(key);
      },
    }));
    const key = recordingKey;
    await prisma.$transaction((tx) => flaky.enqueue(tx, [key], "erasure"));
    expect(await flaky.run()).toEqual({ deleted: 0, failed: 1 });
    expect(await flaky.run()).toEqual({ deleted: 0, failed: 1 });
    const waiting = await prisma.systemFileDeletion.findFirstOrThrow();
    expect(waiting).toMatchObject({ storageKey: key, attempts: 2, lastError: "storage is down" });
    expect(await getFileStorage().exists(key)).toBe(true);
    down = false;
    expect(await flaky.run()).toEqual({ deleted: 1, failed: 0 });
    expect(deleted).toEqual([key]);
    expect(await prisma.systemFileDeletion.count()).toBe(0);
    expect(await getFileStorage().exists(key)).toBe(false);
  });

  it("one stubborn file doesn't stop the others", async () => {
    const flaky = createFileDeletionService(fileDeletionRepository, () => ({
      delete: async (key: string) => {
        if (key.endsWith("bad.mp3")) throw new Error("no");
      },
    }));
    await prisma.$transaction((tx) =>
      flaky.enqueue(tx, ["recordings/2026-11/bad.mp3", "recordings/2026-11/good.mp3"], "erasure"),
    );
    expect(await flaky.run()).toEqual({ deleted: 1, failed: 1 });
    expect((await prisma.systemFileDeletion.findFirstOrThrow()).storageKey).toContain("bad");
  });

  it("is safe twice, and can't reach the wrong person (P10-ERASE-03)", async () => {
    const asha = await fullCustomer();
    const other = await fullCustomer("+919812345679");
    const context = await ctx();
    const wrong = await failure(
      service.erase(context, asha.contact.id, { confirmPhone: "+919812345679" }),
    );
    expect(wrong.code).toBe("VALIDATION_FAILED");
    const untouched = await prisma.leadsContact.findUniqueOrThrow({
      where: { id: asha.contact.id },
    });
    expect(untouched.anonymisedAt).toBeNull();

    await service.erase(context, asha.contact.id, { confirmPhone: PHONE });
    const first = await prisma.leadsContact.findUniqueOrThrow({ where: { id: asha.contact.id } });
    const again = await service.erase(context, asha.contact.id, { confirmPhone: PHONE });
    expect(again.alreadyErased).toBe(true);
    const second = await prisma.leadsContact.findUniqueOrThrow({ where: { id: asha.contact.id } });
    expect(second.anonymisedAt).toEqual(first.anonymisedAt);
    expect(await prisma.auditEvent.count({ where: { action: "contact.erased" } })).toBe(1);

    const neighbour = await prisma.leadsContact.findUniqueOrThrow({
      where: { id: other.contact.id },
    });
    expect(neighbour).toMatchObject({ phoneE164: "+919812345679", anonymisedAt: null });
    expect(await prisma.leadsNote.count({ where: { body: MARK } })).toBe(1);
    expect(await getFileStorage().exists(other.recordingKey)).toBe(true);
  });

  it("treats an erased customer who writes again as new (P10-ERASE-04)", async () => {
    const { contact, lead } = await fullCustomer();
    await service.erase(await ctx(), contact.id, { confirmPhone: PHONE });
    const again = await prisma.$transaction((tx) =>
      resolveLeadForInbound(tx, { phoneE164: PHONE, profileName: "Asha", occurredAt: NOW }),
    );
    expect(again.created).toBe(true);
    expect(again.contact.id).not.toBe(contact.id);
    expect(again.leadId).not.toBe(lead.id);
    expect(again.contact.optInStatus).toBe("UNKNOWN");
  });

  it("refuses while a lead is open, a call is live or a hold is on (P10-ERASE-05, -10)", async () => {
    const context = await ctx();
    const open = await fullCustomer("+919812345670", "NEW");
    expect(
      (await failure(service.erase(context, open.contact.id, { confirmPhone: "+919812345670" })))
        .code,
    ).toBe("CONFLICT");

    const live = await fullCustomer("+919812345671");
    await prisma.telephonyCall.update({
      where: { id: live.call.id },
      data: { status: "ANSWERED" },
    });
    expect(
      (await failure(service.erase(context, live.contact.id, { confirmPhone: "+919812345671" })))
        .code,
    ).toBe("CONFLICT");

    const held = await fullCustomer("+919812345672");
    await service.setHold(context, held.contact.id, { on: true, reason: "legal_claim" });
    expect(
      (await failure(service.erase(context, held.contact.id, { confirmPhone: "+919812345672" })))
        .code,
    ).toBe("CONFLICT");
    expect(
      (await prisma.leadsContact.findUniqueOrThrow({ where: { id: held.contact.id } }))
        .anonymisedAt,
    ).toBeNull();

    await service.setHold(context, held.contact.id, { on: false });
    await service.erase(context, held.contact.id, { confirmPhone: "+919812345672" });
    expect(await prisma.auditEvent.count({ where: { action: "contact.hold_changed" } })).toBe(2);
  });

  it("needs the erase permission, and a Manager or Agent has none (P10-ERASE-07)", async () => {
    const { contact } = await fullCustomer();
    for (const role of ["MANAGER", "AGENT"]) {
      const context = await ctx(role);
      expect(
        (await failure(service.erase(context, contact.id, { confirmPhone: PHONE }))).code,
      ).toBe("FORBIDDEN");
      expect((await failure(service.exportData(context, contact.id))).code).toBe("FORBIDDEN");
      expect((await failure(service.getRecord(context, contact.id))).code).toBe("FORBIDDEN");
    }
  });
});

describe("after erasure", () => {
  it("the lead can't change, and search doesn't find the customer", async () => {
    const { createLeadService } = await import("@/modules/leads");
    const { contact, lead } = await fullCustomer();
    const context = await ctx();
    await service.erase(context, contact.id, { confirmPhone: PHONE });
    const leads = createLeadService();
    expect((await failure(leads.addNote(context, lead.id, { body: "x" }))).code).toBe("CONFLICT");
    expect((await failure(leads.moveStage(context, lead.id, { stageCode: "NEW" }))).code).toBe(
      "CONFLICT",
    );
    expect((await service.search(context, { search: "98123" })).contacts).toEqual([]);
    expect((await service.search(context, { search: "Erased" })).contacts).toEqual([]);
    const page = await leads.listLeads(context, {
      search: "9812345678",
      page: 1,
      pageSize: 25,
      sort: "createdAt",
      direction: "desc",
    } as never);
    expect(page.items.map((item) => item.id)).not.toContain(lead.id);
    expect((await failure(service.exportData(context, contact.id))).code).toBe("CONFLICT");
  });
});

describe("data export", () => {
  it("gives this person's data only, and records the export (P10-ERASE-07, P10-AUDV-04)", async () => {
    const asha = await fullCustomer();
    const other = await fullCustomer("+919812345679");
    await prisma.leadsContact.update({
      where: { id: other.contact.id },
      data: { name: "Someone Else" },
    });
    await prisma.leadsNote.create({
      data: {
        leadId: other.lead.id,
        authorUserId: other.agent.id,
        body: "OTHER PERSON NOTE",
        createdAt: NOW,
      },
    });
    const context = await ctx();
    const response = await service.exportData(context, asha.contact.id);
    const body = await response.text();
    const data = JSON.parse(body) as {
      phone: string;
      leads: Array<{ notes: Array<{ body: string }> }>;
      messages: Array<{ body: string }>;
      calls: Array<{ outcomeNotes: string; recording: { status: string } }>;
    };
    expect(data.phone).toBe(PHONE);
    expect(data.leads[0].notes[0].body).toBe(MARK);
    expect(data.messages[0].body).toBe(MARK);
    expect(data.calls[0]).toMatchObject({ outcomeNotes: MARK, recording: { status: "STORED" } });
    expect(body).not.toContain("Someone Else");
    expect(body).not.toContain("OTHER PERSON NOTE");
    expect(body).not.toContain("+919812345679");
    expect(body).not.toContain("passwordHash");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(
      await prisma.auditEvent.count({
        where: { action: "contact.data_exported", entityId: asha.contact.id },
      }),
    ).toBe(1);
  });

  it("opening a record is audited (P10-AUDV-04)", async () => {
    const { contact } = await fullCustomer();
    const context = await ctx();
    await service.getRecord(context, contact.id);
    expect(
      await prisma.auditEvent.findFirstOrThrow({ where: { action: "contact.viewed" } }),
    ).toMatchObject({ entityId: contact.id, actorUserId: context.principal.userId });
  });
});

describe("consent", () => {
  it("keeps who, when and how, and the rows can't be changed (P10-ERASE-08)", async () => {
    const { contact } = await fullCustomer();
    const context = await ctx();
    await service.recordConsent(context, contact.id, {
      purpose: "WHATSAPP",
      status: "WITHDRAWN",
      source: "phone_call",
    });
    const row = await prisma.leadsConsentRecord.findFirstOrThrow({
      where: { contactId: contact.id },
    });
    expect(row).toMatchObject({
      purpose: "WHATSAPP",
      status: "WITHDRAWN",
      source: "phone_call",
      recordedByUserId: context.principal.userId,
      occurredAt: NOW,
    });
    expect(
      (await prisma.leadsContact.findUniqueOrThrow({ where: { id: contact.id } })).optInStatus,
    ).toBe("OPTED_OUT");
    await expect(
      prisma.leadsConsentRecord.update({ where: { id: row.id }, data: { source: "x" } }),
    ).rejects.toThrow();
    await expect(prisma.leadsConsentRecord.delete({ where: { id: row.id } })).rejects.toThrow();
    expect(await prisma.auditEvent.count({ where: { action: "contact.opt_changed" } })).toBe(1);
    // The same answer again adds nothing.
    await service.recordConsent(context, contact.id, {
      purpose: "WHATSAPP",
      status: "WITHDRAWN",
      source: "email",
    });
    expect(await prisma.leadsConsentRecord.count({ where: { contactId: contact.id } })).toBe(1);
  });

  it("a customer's own opt-out is recorded with no staff member (P10-ERASE-08)", async () => {
    const { setContactOpt } = await import("@/modules/leads");
    const { contact } = await fullCustomer();
    await prisma.$transaction((tx) =>
      setContactOpt(tx, {
        contactId: contact.id,
        status: "OPTED_OUT",
        source: "whatsapp_keyword",
        at: NOW,
        actor: null,
      }),
    );
    expect(await prisma.leadsConsentRecord.findFirstOrThrow()).toMatchObject({
      status: "WITHDRAWN",
      source: "whatsapp_keyword",
      recordedByUserId: null,
    });
  });

  it("withdrawing recording consent means the next recording isn't kept (P10-ERASE-08)", async () => {
    const { contact, lead, agent } = await fullCustomer();
    const context = await ctx();
    await service.recordConsent(context, contact.id, {
      purpose: "CALL_RECORDING",
      status: "WITHDRAWN",
      source: "phone_call",
    });
    const call = await prisma.telephonyCall.create({
      data: {
        providerKey: "fake",
        providerCallId: "provider-1",
        callRef: randomUUID(),
        leadId: lead.id,
        agentUserId: agent.id,
        customerPhoneE164: PHONE,
        status: "COMPLETED",
        startedAt: NOW,
      },
    });
    const fetched: string[] = [];
    const telephony = createTelephonyService({
      clock: createTestClock(NOW.toISOString()),
      enqueue: false,
      provider: () =>
        ({
          key: "fake",
          fetchRecording: async (ref: string) => {
            fetched.push(ref);
            return Readable.from([]);
          },
        }) as never,
    });
    const event = await prisma.telephonyWebhookEvent.create({
      data: {
        providerKey: "fake",
        eventKey: "rec-1",
        payload: {
          kind: "recording",
          key: "rec-1",
          providerCallId: "provider-1",
          callRef: call.callRef,
          recordingRef: "ref-1",
          occurredAt: NOW.toISOString(),
        },
      },
    });
    await telephony.processEvent(event.id);
    const recording = await prisma.telephonyRecording.findUnique({ where: { callId: call.id } });
    expect(recording).toMatchObject({ status: "DELETED", storageKey: null });
    expect(fetched).toEqual([]);
  });
});
