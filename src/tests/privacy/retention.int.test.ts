// Phase 10: each retention job deletes exactly what is past its date, by business day, safely twice,
// in small batches (P10-ERASE-09), and leaves records on hold alone (P10-ERASE-10).
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { createMessagingRetention } from "@/modules/messaging/messaging.retention";
import { runFileDeletions } from "@/modules/system";
import { createTelephonyService } from "@/modules/telephony/telephony.service";
import { getPrisma } from "@/shared/db/prisma";
import { getFileStorage } from "@/shared/storage";
import { createTestClock, parseBusinessLocalDateTime as at, plusDuration } from "@/shared/time";
import { resetDatabase } from "@/tests/setup/resetDatabase";

const prisma = getPrisma();
// 730 days before 6 Nov 2026 is 6 Nov 2024 by the calendar; 30 days before is 7 Oct 2026.
const NOW = at("2026-11-06", "01:00");
const clock = createTestClock(NOW.toISOString());
const retention = createMessagingRetention(clock);
const telephony = createTelephonyService({ clock, enqueue: false });
let counter = 0;

async function conversation(stage = "LOST", hold = false) {
  const stageRow = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: stage } });
  const contact = await prisma.leadsContact.create({
    data: {
      phoneE164: `+9198${String(70000000 + ++counter)}`,
      legalHoldAt: hold ? NOW : null,
    },
  });
  const lead = await prisma.leadsLead.create({
    data: { contactId: contact.id, stageId: stageRow.id },
  });
  const row = await prisma.messagingConversation.create({
    data: {
      businessPhoneNumberId: "biz",
      waId: contact.phoneE164.slice(1),
      contactId: contact.id,
      leadId: lead.id,
    },
  });
  return { ...row, leadId: lead.id };
}
const message = (conversationId: string, occurredAt: Date, extra = {}) =>
  prisma.messagingMessage.create({
    data: {
      conversationId,
      direction: "INBOUND",
      type: "TEXT",
      body: "hello",
      status: "RECEIVED",
      occurredAt,
      ...extra,
    },
  });
const exists = async (id: string) => (await prisma.messagingMessage.count({ where: { id } })) === 1;

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
});
afterAll(async () => {
  await resetDatabase();
});

describe("messages", () => {
  it("goes by the business day, not the UTC one", async () => {
    const { id } = await conversation();
    // 23:59 IST on 5 Nov 2024 is past its date; 00:00 IST on 6 Nov 2024 is the first day kept. In UTC
    // both fall on 5 Nov, so a UTC cut-off would treat them alike.
    const old = await message(id, at("2024-11-05", "23:59"));
    const kept = await message(id, at("2024-11-06", "00:00"));
    expect(await retention.deleteOldMessages()).toBe(1);
    expect(await exists(old.id)).toBe(false);
    expect(await exists(kept.id)).toBe(true);
    expect(await retention.deleteOldMessages()).toBe(0);
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "retention.messages_deleted" },
    });
    expect(event.metadata).toEqual({ count: 1 });
    expect(await prisma.auditEvent.count({ where: { action: "retention.messages_deleted" } })).toBe(
      1,
    );
  });

  it("uses the current setting", async () => {
    await prisma.systemSetting.create({ data: { key: "retention.messageDays", value: 10 } });
    const { id } = await conversation();
    const old = await message(id, at("2026-10-26", "12:00"));
    const kept = await message(id, at("2026-10-27", "12:00"));
    expect(await retention.deleteOldMessages()).toBe(1);
    expect(await exists(old.id)).toBe(false);
    expect(await exists(kept.id)).toBe(true);
  });

  it("deletes the message's file too, and a provider's reference is left alone", async () => {
    const { id } = await conversation();
    const key = `uploads/2024-01/${randomUUID()}.jpg`;
    await getFileStorage().put(key, Buffer.from("photo"), "image/jpeg");
    await message(id, at("2024-01-01", "12:00"), { mediaRef: key, mediaStatus: "STORED" });
    await message(id, at("2024-01-01", "12:00"), {
      mediaRef: "provider-id",
      mediaStatus: "PENDING",
    });
    expect(await retention.deleteOldMessages()).toBe(2);
    expect(await getFileStorage().exists(key)).toBe(false);
    expect(await prisma.systemFileDeletion.count()).toBe(0);
  });

  it("keeps a held customer's messages and an open lead's (P10-ERASE-10)", async () => {
    const held = await message((await conversation("LOST", true)).id, at("2024-01-01", "12:00"));
    const open = await message((await conversation("NEW")).id, at("2024-01-01", "12:00"));
    const noLead = await conversation();
    await prisma.messagingConversation.update({ where: { id: noLead.id }, data: { leadId: null } });
    const orphan = await message(noLead.id, at("2024-01-01", "12:00"));
    const closed = await message((await conversation()).id, at("2024-01-01", "12:00"));
    expect(await retention.deleteOldMessages()).toBe(2);
    expect(await exists(held.id)).toBe(true);
    expect(await exists(open.id)).toBe(true);
    expect(await exists(orphan.id)).toBe(false);
    expect(await exists(closed.id)).toBe(false);
  });

  it("works through more than one batch", async () => {
    const { id } = await conversation();
    await prisma.messagingMessage.createMany({
      data: Array.from({ length: 1200 }, () => ({
        id: randomUUID(),
        conversationId: id,
        direction: "INBOUND" as const,
        type: "TEXT" as const,
        body: "x",
        status: "RECEIVED" as const,
        occurredAt: at("2024-01-01", "12:00"),
      })),
    });
    expect(await retention.deleteOldMessages()).toBe(1200);
    expect(await prisma.messagingMessage.count()).toBe(0);
  });
});

describe("webhook logs", () => {
  it("each module deletes its own, by business day, safely twice", async () => {
    const whatsapp = (receivedAt: Date) =>
      prisma.messagingWebhookEvent.create({
        data: { eventKey: randomUUID(), kind: "message", payload: {}, receivedAt },
      });
    const calling = (receivedAt: Date) =>
      prisma.telephonyWebhookEvent.create({
        data: { providerKey: "fake", eventKey: randomUUID(), payload: {}, receivedAt },
      });
    const oldMessage = await whatsapp(at("2026-10-06", "23:59"));
    const keptMessage = await whatsapp(at("2026-10-07", "00:00"));
    const oldCall = await calling(at("2026-10-06", "23:59"));
    const keptCall = await calling(at("2026-10-07", "00:00"));
    expect(await retention.deleteOldWebhookEvents()).toBe(1);
    expect(await retention.deleteOldWebhookEvents()).toBe(0);
    expect(await telephony.deleteOldWebhookEvents()).toBe(1);
    expect(await telephony.deleteOldWebhookEvents()).toBe(0);
    const messages = await prisma.messagingWebhookEvent.findMany({ select: { id: true } });
    expect(messages.map((row) => row.id)).toEqual([keptMessage.id]);
    const calls = await prisma.telephonyWebhookEvent.findMany({ select: { id: true } });
    expect(calls.map((row) => row.id)).toEqual([keptCall.id]);
    expect([oldMessage.id, oldCall.id]).toHaveLength(2);
  });
});

describe("recordings", () => {
  async function recording(hold: boolean, expiresAt: Date) {
    const { leadId } = await conversation("LOST", hold);
    const call = await prisma.telephonyCall.create({
      data: {
        providerKey: "fake",
        callRef: randomUUID(),
        leadId,
        customerPhoneE164: "+919800000000",
        status: "COMPLETED",
        startedAt: NOW,
      },
    });
    const key = `recordings/2026-08/${call.id}.mp3`;
    await getFileStorage().put(key, Buffer.from("voice"), "audio/mpeg");
    await prisma.telephonyRecording.create({
      data: { callId: call.id, status: "STORED", storageKey: key, expiresAt },
    });
    return { callId: call.id, key };
  }

  it("deletes what is past its date and keeps what is on hold (P10-ERASE-10)", async () => {
    const past = await recording(false, plusDuration(NOW, { hours: -1 }));
    const held = await recording(true, plusDuration(NOW, { hours: -1 }));
    const future = await recording(false, plusDuration(NOW, { hours: 1 }));
    expect(await telephony.deleteExpiredRecordings()).toBe(1);
    expect(await telephony.deleteExpiredRecordings()).toBe(0);
    expect(await getFileStorage().exists(past.key)).toBe(false);
    expect(await getFileStorage().exists(held.key)).toBe(true);
    expect(await getFileStorage().exists(future.key)).toBe(true);
    expect(
      await prisma.telephonyRecording.findUniqueOrThrow({ where: { callId: past.callId } }),
    ).toMatchObject({ status: "DELETED", storageKey: null });
    await runFileDeletions();
    expect(await prisma.systemFileDeletion.count()).toBe(0);
  });
});
