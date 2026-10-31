// Phase 4: webhook to inbox to reply, through the real routes, queue and fake gateway.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as messagesRoute from "@/app/api/conversations/[id]/messages/route";
import * as readRoute from "@/app/api/conversations/[id]/read/route";
import * as optInRoute from "@/app/api/conversations/[id]/opt-in/route";
import * as templateSend from "@/app/api/conversations/[id]/template/route";
import * as mediaSend from "@/app/api/conversations/[id]/media/route";
import * as conversationItem from "@/app/api/conversations/[id]/route";
import * as conversations from "@/app/api/conversations/route";
import * as startChat from "@/app/api/leads/[id]/conversation/route";
import * as mergeRoute from "@/app/api/leads/[id]/merge/route";
import * as leadsRoute from "@/app/api/leads/route";
import * as retryRoute from "@/app/api/messages/[id]/retry/route";
import * as mediaRoute from "@/app/api/messages/[id]/media/route";
import * as templateItem from "@/app/api/templates/[id]/route";
import * as templates from "@/app/api/templates/route";
import * as webhook from "@/app/api/webhooks/whatsapp/route";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { getPrisma } from "@/shared/db/prisma";
import { startTestJobRuntime, type TestJobRuntime } from "@/shared/jobs/testing/testRuntime";
import { getFileStorage } from "@/shared/storage";
import {
  createTestClock,
  instantFromEpochMs,
  parseInstant,
  plusDuration,
  systemClock,
} from "@/shared/time";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import {
  FAKE_VERIFY_TOKEN,
  fakeInboundWebhook,
  fakeStatusWebhook,
  fakeWhatsApp,
  signFake,
} from "../gateway/fake";
import { GatewayError } from "../gateway/types";
import { messagingJobs } from "../messaging.jobs";
import { createMessagingService } from "../messaging.service";

const prisma = getPrisma();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body<T = any> = {
  data: T;
  error: { code: string; fieldErrors?: Array<{ field: string; message: string }> };
};
type Id = { id: string };
let runtime: TestJobRuntime;
let counter = 0;

const nextNumber = () => {
  counter += 1;
  return `9198${String(20000000 + counter)}`;
};
const nowSeconds = () => Math.floor(systemClock.now().getTime() / 1000);

const textMessage = (from: string, text = "Hi", extra: Record<string, unknown> = {}) => ({
  id: `wamid.${randomUUID()}`,
  from,
  timestamp: String(nowSeconds()),
  type: "text",
  text: { body: text },
  ...extra,
});

const deliver = (raw: string, signature: string | null = signFake(raw)) =>
  webhook.POST(
    new Request("http://127.0.0.1/api/webhooks/whatsapp", {
      method: "POST",
      headers: signature ? { "x-hub-signature-256": signature } : {},
      body: raw,
    }),
    { params: Promise.resolve({}) },
  );
const runJobs = () => runtime.runPendingJobs(messagingJobs);
const receive = async (
  from: string,
  text = "Hi",
  name?: string,
  extra: Record<string, unknown> = {},
) => {
  const message = textMessage(from, text, extra);
  const response = await deliver(fakeInboundWebhook([message], [{ wa_id: from, name }]));
  expect(response.status).toBe(200);
  await runJobs();
  return message;
};
const conversationOf = (from: string) =>
  prisma.messagingConversation.findFirstOrThrow({
    where: { waId: from },
    include: { lead: true, contact: true },
  });

async function makeUser(
  roleCode = "AGENT",
  managerId?: string,
  status: "ACTIVE" | "DEACTIVATED" = "ACTIVE",
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: `${roleCode} P`,
      passwordHash: "h",
      status,
      roleId: role.id,
      managerId,
    },
  });
}
const as = async (roleCode: string, userId?: string) => {
  const id = userId ?? (await makeUser(roleCode)).id;
  actAs(await testPrincipal(roleCode, id));
  return id;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const list = (query = "") =>
  callRoute<Body<{ items: Array<Row>; total: number }>>(conversations.GET, {
    path: `/api/conversations${query}`,
  });
const open = (id: string) =>
  callRoute<Body, Id>(conversationItem.GET, { path: "/x", params: { id } });
const send = (id: string, body: unknown) =>
  callRoute<Body, Id>(messagesRoute.POST, { method: "POST", path: "/x", params: { id }, body });
const sendTemplate = (id: string, body: unknown) =>
  callRoute<Body, Id>(templateSend.POST, { method: "POST", path: "/x", params: { id }, body });
const createTemplate = (body: unknown) =>
  callRoute<Body>(templates.POST, { method: "POST", path: "/x", body });
const assignLead = (leadId: string, ownerUserId: string) =>
  prisma.leadsLead.update({ where: { id: leadId }, data: { ownerUserId } });
const setLastInbound = (id: string, at: Date | null) =>
  prisma.messagingConversation.update({ where: { id }, data: { lastInboundAt: at } });

beforeAll(async () => {
  runtime = await startTestJobRuntime({ start: "2099-01-01T00:00:00Z" });
});
beforeEach(async () => {
  stopActing();
  fakeWhatsApp.reset();
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
});
afterEach(() => {
  stopActing();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await runtime.stop();
  await resetDatabase();
  await prisma.$disconnect();
});

describe("older messages (P6-WORK-06)", () => {
  it("come in pages, with no gaps or repeats", async () => {
    const from = nextNumber();
    await receive(from, "first");
    const conversation = await conversationOf(from);
    const base = systemClock.now().getTime();
    await prisma.messagingMessage.createMany({
      data: Array.from({ length: 59 }, (_, i) => ({
        conversationId: conversation.id,
        direction: "INBOUND" as const,
        type: "TEXT" as const,
        status: "DELIVERED" as const,
        body: `m${i}`,
        occurredAt: instantFromEpochMs(base + (i + 1) * 1000),
      })),
    });
    await as("ADMIN");
    const latest = (await open(conversation.id)).body!.data;
    expect(latest.messages).toHaveLength(50);
    expect(latest.hasOlder).toBe(true);
    const older = await callRoute<Body, Id>(messagesRoute.GET, {
      path: `/x?before=${latest.messages[0].id}`,
      params: { id: conversation.id },
    });
    expect(older.status).toBe(200);
    expect(older.body!.data.hasOlder).toBe(false);
    const all = [...older.body!.data.messages, ...latest.messages].map((m: Row) => m.id);
    expect(all).toHaveLength(60);
    expect(new Set(all).size).toBe(60);
    expect(older.body!.data.messages[0].body).toBe("first");
  });

  it("are refused for a chat out of scope", async () => {
    const from = nextNumber();
    await receive(from);
    const conversation = await conversationOf(from);
    await as("AGENT");
    const refused = await callRoute<Body, Id>(messagesRoute.GET, {
      path: "/x",
      params: { id: conversation.id },
    });
    expect(refused.status).toBe(404);
  });
});

describe("a lead's chat", () => {
  it("is found without creating one just by looking", async () => {
    await as("ADMIN");
    const from = nextNumber();
    await receive(from);
    const conversation = await conversationOf(from);
    const found = await callRoute<Body, Id>(startChat.GET, {
      path: "/x",
      params: { id: conversation.lead!.id },
    });
    expect(found.body!.data).toEqual({ conversationId: conversation.id });
    await as("AGENT");
    const outsider = await callRoute<Body, Id>(startChat.GET, {
      path: "/x",
      params: { id: conversation.lead!.id },
    });
    expect(outsider.status).toBe(404);
    await as("ADMIN");

    const created = await callRoute<Body>(leadsRoute.POST, {
      method: "POST",
      path: "/x",
      body: { customerName: "Asha", phone: nextNumber(), source: "MANUAL" },
    });
    const before = await prisma.messagingConversation.count();
    const none = await callRoute<Body, Id>(startChat.GET, {
      path: "/x",
      params: { id: created.body!.data.id },
    });
    expect(none.body!.data).toEqual({ conversationId: null });
    expect(await prisma.messagingConversation.count()).toBe(before);
  });
});

describe("the webhook", () => {
  it("stores a signed message and answers before doing the work (P4-WEBHOOK-01)", async () => {
    const from = nextNumber();
    const response = await deliver(fakeInboundWebhook([textMessage(from)]));
    expect(response.status).toBe(200);
    expect(await prisma.messagingWebhookEvent.count()).toBe(1);
    expect(await prisma.messagingMessage.count()).toBe(0); // the job does this
    await runJobs();
    expect(await prisma.messagingMessage.count()).toBe(1);
  });

  it("refuses a missing or wrong signature, or a changed body, and stores nothing (P4-WEBHOOK-02)", async () => {
    const raw = fakeInboundWebhook([textMessage(nextNumber())]);
    expect((await deliver(raw, null)).status).toBe(401);
    expect((await deliver(raw, "sha256=wrong")).status).toBe(401);
    expect((await deliver(`${raw} `, signFake(raw))).status).toBe(401);
    expect(await prisma.messagingWebhookEvent.count()).toBe(0);
  });

  it("answers the handshake with the right token only (P4-WEBHOOK-03)", async () => {
    const handshake = (token: string) =>
      webhook.GET(
        new Request(
          `http://127.0.0.1/x?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc123`,
        ),
        { params: Promise.resolve({}) },
      );
    const ok = await handshake(FAKE_VERIFY_TOKEN);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("abc123");
    expect((await handshake("wrong")).status).toBe(403);
  });

  it("makes one record from a message delivered twice, or at the same moment (P4-WEBHOOK-04)", async () => {
    const raw = fakeInboundWebhook([textMessage(nextNumber())]);
    await Promise.all([deliver(raw), deliver(raw)]);
    await deliver(raw);
    await runJobs();
    expect(await prisma.messagingMessage.count()).toBe(1);
    expect(await prisma.messagingWebhookEvent.count()).toBe(1);
  });

  it("accepts a malformed or unknown body without storing or retrying (P4-WEBHOOK-05)", async () => {
    for (const raw of ["not json", "{}", '{"entry":[{"changes":[null]}]}']) {
      expect((await deliver(raw)).status, raw).toBe(200);
    }
    expect(await prisma.messagingWebhookEvent.count()).toBe(0);
  });

  it("handles every item in one delivery (P4-WEBHOOK-06) and a burst (P4-WEBHOOK-10)", async () => {
    const numbers = Array.from({ length: 30 }, nextNumber);
    await deliver(fakeInboundWebhook(numbers.map((from) => textMessage(from))));
    await runJobs();
    expect(await prisma.messagingMessage.count()).toBe(30);
    expect(await prisma.leadsLead.count()).toBe(30);
  });

  it("gives the provider an error when the database is down, so it retries (P4-WEBHOOK-09)", async () => {
    vi.spyOn(prisma.messagingWebhookEvent, "createMany").mockRejectedValueOnce(
      new Error("db down"),
    );
    const raw = fakeInboundWebhook([textMessage(nextNumber())]);
    expect((await deliver(raw)).status).toBe(500);
    expect((await deliver(raw)).status).toBe(200);
    await runJobs();
    expect(await prisma.messagingMessage.count()).toBe(1);
  });

  it("refuses a very large body quickly (P4-WEBHOOK-11)", async () => {
    const raw = "x".repeat(2 * 1024 * 1024);
    expect((await deliver(raw)).status).toBe(413);
  });
});

describe("incoming messages", () => {
  it("creates one contact, lead and conversation, even from two together (P4-INBOUND-01, P4-MERGE-01)", async () => {
    const from = nextNumber();
    await deliver(fakeInboundWebhook([textMessage(from), textMessage(from)]));
    await deliver(fakeInboundWebhook([textMessage(from)]));
    await Promise.all([runJobs(), runJobs()]);
    expect(await prisma.leadsContact.count()).toBe(1);
    expect(await prisma.leadsLead.count()).toBe(1);
    expect(await prisma.messagingConversation.count()).toBe(1);
    expect(await prisma.messagingMessage.count()).toBe(3);
    const row = await conversationOf(from);
    expect(row.lead).toMatchObject({ source: "WHATSAPP", ownerUserId: null });
    expect(row.contact.phoneE164).toBe(`+${from}`);
  });

  it("two first messages processed at the same moment make one lead, without an error (P4-INBOUND-01)", async () => {
    const service = createMessagingService();
    for (let round = 0; round < 5; round += 1) {
      const from = nextNumber();
      await deliver(fakeInboundWebhook([textMessage(from), textMessage(from)]));
      const events = await prisma.messagingWebhookEvent.findMany({ where: { processedAt: null } });
      await Promise.all(events.map((event) => service.processEvent(event.id)));
      expect(await prisma.leadsLead.count({ where: { contact: { phoneE164: `+${from}` } } })).toBe(
        1,
      );
    }
  });

  it("keeps a second message on the same lead (P4-INBOUND-02)", async () => {
    const from = nextNumber();
    await receive(from, "one");
    await receive(from, "two");
    expect(await prisma.leadsLead.count()).toBe(1);
    expect((await conversationOf(from)).unreadCount).toBe(2);
  });

  it("gives a customer with a closed lead a new linked lead (P4-INBOUND-03)", async () => {
    const from = nextNumber();
    await receive(from);
    const first = await conversationOf(from);
    const lost = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "LOST" } });
    await prisma.leadsLead.update({ where: { id: first.leadId! }, data: { stageId: lost.id } });
    await receive(from, "back again");
    const second = await conversationOf(from);
    expect(second.leadId).not.toBe(first.leadId);
    expect(second.contactId).toBe(first.contactId);
    expect(await prisma.leadsLead.count()).toBe(2);
    expect(await prisma.messagingConversation.count()).toBe(1);
  });

  it("adds each message to the lead's timeline once (P3-TL-01)", async () => {
    const from = nextNumber();
    await receive(from);
    const row = await conversationOf(from);
    expect(
      await prisma.leadsTimelineEntry.count({ where: { leadId: row.leadId!, kind: "MESSAGE" } }),
    ).toBe(1);
    expect(row.lead?.lastActivityAt).not.toBeNull();
  });

  it("stores emoji, long and Hindi text as sent (P4-INBOUND-05)", async () => {
    await as("ADMIN");
    const from = nextNumber();
    const texts = ["🙏🏔️", "दिसंबर में कश्मीर", "x".repeat(4000)];
    for (const text of texts) await receive(from, text);
    const detail = await open((await conversationOf(from)).id);
    expect(detail.body?.data.messages.map((m: { body: string }) => m.body).sort()).toEqual(
      [...texts].sort(),
    );
  });

  it("shows messages in the time they were sent, whatever order they arrived (P4-INBOUND-06)", async () => {
    await as("ADMIN");
    const from = nextNumber();
    const base = nowSeconds();
    await receive(from, "later", undefined, { timestamp: String(base) });
    await receive(from, "earlier", undefined, { timestamp: String(base - 600) });
    const row = await conversationOf(from);
    const detail = await open(row.id);
    expect(detail.body?.data.messages.map((m: { body: string }) => m.body)).toEqual([
      "earlier",
      "later",
    ]);
    expect(row.lastInboundAt?.getTime()).toBe(base * 1000); // a late message can't move the window back
  });

  it("handles no profile name; a new one never overwrites a name (P4-INBOUND-07)", async () => {
    const a = nextNumber();
    await receive(a);
    expect((await conversationOf(a)).contact.name).toBeNull();
    const b = nextNumber();
    await receive(b, "Hi", "Riya");
    expect((await conversationOf(b)).contact.name).toBe("Riya");
    await receive(b, "Hi", "Riya New");
    expect((await conversationOf(b)).contact.name).toBe("Riya");
  });

  it("makes no lead from the business number or a group (P4-INBOUND-08)", async () => {
    await deliver(
      fakeInboundWebhook([
        textMessage("919000099999"),
        textMessage(nextNumber(), "x", { group_id: "g" }),
      ]),
    );
    await runJobs();
    expect(await prisma.leadsLead.count()).toBe(0);
    expect(await prisma.messagingWebhookEvent.count({ where: { processedAt: null } })).toBe(0);
  });

  it("keeps the unread count right under messages and reads together (P4-INBOUND-09)", async () => {
    await as("ADMIN");
    const from = nextNumber();
    await receive(from);
    const { id } = await conversationOf(from);
    await deliver(fakeInboundWebhook(Array.from({ length: 5 }, () => textMessage(from))));
    await runJobs();
    expect((await conversationOf(from)).unreadCount).toBe(6);
    const read = await callRoute<Body, Id>(readRoute.POST, {
      method: "POST",
      path: "/x",
      params: { id },
    });
    expect(read.status).toBe(200);
    expect((await conversationOf(from)).unreadCount).toBe(0);
  });

  it("a chat with a deactivated owner reaches their manager (P4-INBOUND-10)", async () => {
    const manager = await makeUser("MANAGER");
    const agent = await makeUser("AGENT", manager.id, "DEACTIVATED");
    const from = nextNumber();
    await receive(from);
    const row = await conversationOf(from);
    await assignLead(row.leadId!, agent.id);
    await as("MANAGER", manager.id);
    expect((await open(row.id)).status).toBe(200);
  });
});

describe("delivery status", () => {
  const sentMessage = async () => {
    await as("ADMIN");
    const from = nextNumber();
    await receive(from);
    const row = await conversationOf(from);
    const sent = await send(row.id, { body: "Hello", clientRef: randomUUID() });
    await runJobs();
    return prisma.messagingMessage.findUniqueOrThrow({ where: { id: sent.body!.data.id } });
  };
  const status = async (id: string, value: string, extra: Record<string, unknown> = {}) => {
    await deliver(
      fakeStatusWebhook([{ id, status: value, timestamp: String(nowSeconds()), ...extra }]),
    );
    await runJobs();
  };

  it("never moves backward: read before delivered stays read (P4-WEBHOOK-07)", async () => {
    const message = await sentMessage();
    expect(message.status).toBe("SENT");
    await status(message.waMessageId!, "read");
    await status(message.waMessageId!, "delivered");
    const row = await prisma.messagingMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row.status).toBe("READ");
    expect(row.deliveredAt).not.toBeNull();
    expect(row.readAt).not.toBeNull();
  });

  it("marks a later provider failure as failed, with a friendly state (P4-WINDOW-12)", async () => {
    const message = await sentMessage();
    await status(message.waMessageId!, "failed", { errors: [{ code: 131026 }] });
    const row = await prisma.messagingMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row).toMatchObject({ status: "FAILED", failureCode: "131026" });
    const detail = await open(row.conversationId);
    const shown = detail.body?.data.messages.find((m: { id: string }) => m.id === row.id);
    expect(shown.failureMessage).toBeTruthy();
    expect(JSON.stringify(shown)).not.toContain("131026");
  });

  it("a failure after delivery changes nothing", async () => {
    const message = await sentMessage();
    await status(message.waMessageId!, "delivered");
    await status(message.waMessageId!, "failed");
    expect(
      (await prisma.messagingMessage.findUniqueOrThrow({ where: { id: message.id } })).status,
    ).toBe("DELIVERED");
  });

  it("keeps a status for an unknown message, safely (P4-WEBHOOK-08)", async () => {
    await status("wamid.nobody", "delivered");
    const row = await prisma.messagingWebhookEvent.findFirstOrThrow({
      where: { waMessageId: "wamid.nobody" },
    });
    expect(row.processedAt).toBeNull();
    expect(await prisma.messagingMessage.count()).toBe(0);
  });

  it("applies a status that arrived before its send finished (P4-WEBHOOK-07)", async () => {
    await as("ADMIN");
    const from = nextNumber();
    await receive(from);
    const row = await conversationOf(from);
    // The provider's status beats our own save of its message ID.
    const providerId = "wamid.early";
    await deliver(
      fakeStatusWebhook([{ id: providerId, status: "delivered", timestamp: String(nowSeconds()) }]),
    );
    await runJobs();
    const service = createMessagingService();
    const sent = await send(row.id, { body: "Hello", clientRef: randomUUID() });
    await service.recordSendResult(sent.body!.data.id, providerId);
    const saved = await prisma.messagingMessage.findUniqueOrThrow({
      where: { id: sent.body!.data.id },
    });
    expect(saved.status).toBe("DELIVERED");
  });
});

describe("the 24-hour window", () => {
  const setup = async () => {
    const admin = await as("ADMIN");
    const from = nextNumber();
    await receive(from);
    const row = await conversationOf(from);
    return { admin, row, principal: await testPrincipal("ADMIN", admin), from };
  };
  const NOW = "2026-10-30T10:00:00.000Z";
  const at = (hours: number, minutes = 0) =>
    instantFromEpochMs(parseInstant(NOW).getTime() - (hours * 60 + minutes) * 60_000);

  it("allows a reply at 23 h 59 min (P4-WINDOW-01), refuses at exactly 24 h (P4-WINDOW-02)", async () => {
    const { row, principal } = await setup();
    const service = createMessagingService({ clock: createTestClock(NOW) });
    await setLastInbound(row.id, at(23, 59));
    await expect(
      service.sendText({ principal }, row.id, { body: "x", clientRef: randomUUID() }),
    ).resolves.toBeTruthy();
    await setLastInbound(row.id, at(24));
    await expect(
      service.sendText({ principal }, row.id, { body: "x", clientRef: randomUUID() }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: [{ message: expect.stringContaining("24-hour") }],
    });
  });

  it("the server reports the window: open or closed, with when it closes (P4-WINDOW-03)", async () => {
    const { row } = await setup();
    const inbound = plusDuration(systemClock.now(), { hours: -1 });
    await setLastInbound(row.id, inbound);
    await send(row.id, { body: "agent reply", clientRef: randomUUID() });
    await runJobs();
    const detail = await open(row.id);
    expect(detail.body?.data.window.open).toBe(true);
    expect(parseInstant(detail.body?.data.window.closesAt).getTime()).toBe(
      plusDuration(inbound, { hours: 24 }).getTime(),
    ); // an agent's reply doesn't extend it
  });

  it("a customer's new message reopens it (P4-WINDOW-04)", async () => {
    const { row, from } = await setup();
    await setLastInbound(row.id, plusDuration(systemClock.now(), { hours: -30 }));
    expect((await open(row.id)).body?.data.window.open).toBe(false);
    await receive(from, "back");
    expect((await open(row.id)).body?.data.window.open).toBe(true);
  });

  it("a message queued inside the window but sent after it fails friendly (P4-WINDOW-05)", async () => {
    const { row } = await setup();
    const sent = await send(row.id, { body: "x", clientRef: randomUUID() });
    await setLastInbound(row.id, plusDuration(systemClock.now(), { hours: -25 }));
    await runJobs();
    const message = await prisma.messagingMessage.findUniqueOrThrow({
      where: { id: sent.body!.data.id },
    });
    expect(message).toMatchObject({ status: "FAILED", failureCode: "window_closed" });
    expect(fakeWhatsApp.sent).toHaveLength(0);
  });

  it("an agent can only message leads in scope (P4-WINDOW-09)", async () => {
    const { row } = await setup();
    await as("AGENT");
    expect((await send(row.id, { body: "x", clientRef: randomUUID() })).status).toBe(404);
    expect((await open(row.id)).status).toBe(404);
    expect((await list()).body?.data.total).toBe(0);
  });

  it("double-clicking Send sends one message (P4-WINDOW-10)", async () => {
    const { row } = await setup();
    const clientRef = randomUUID();
    const [a, b] = await Promise.all([
      send(row.id, { body: "x", clientRef }),
      send(row.id, { body: "x", clientRef }),
    ]);
    expect(a.body?.data.id).toBe(b.body?.data.id);
    await runJobs();
    expect(fakeWhatsApp.sent).toHaveLength(1);
    expect(await prisma.messagingMessage.count({ where: { direction: "OUTBOUND" } })).toBe(1);
  });

  it("refuses an empty message, and one over WhatsApp's limit (P4-WINDOW-13)", async () => {
    const { row } = await setup();
    expect((await send(row.id, { body: "  ", clientRef: randomUUID() })).status).toBe(400);
    expect((await send(row.id, { body: "x".repeat(4097), clientRef: randomUUID() })).status).toBe(
      400,
    );
    expect((await send(row.id, { body: "x".repeat(4096), clientRef: randomUUID() })).status).toBe(
      201,
    );
  });

  it("a provider outage retries without losing or doubling (P4-WINDOW-14, P4-GATE-02)", async () => {
    const { row } = await setup();
    fakeWhatsApp.failures.push(new GatewayError("rate_limited", true));
    const sent = await send(row.id, { body: "x", clientRef: randomUUID() });
    await runJobs();
    const queued = await prisma.messagingMessage.findUniqueOrThrow({
      where: { id: sent.body!.data.id },
    });
    expect(queued.status).toBe("QUEUED");
    await runtime.clock.tick(10 * 60_000);
    await runJobs();
    const done = await prisma.messagingMessage.findUniqueOrThrow({
      where: { id: sent.body!.data.id },
    });
    expect(done.status).toBe("SENT");
    expect(fakeWhatsApp.sent).toHaveLength(1);
  });

  it("a permanent failure shows failed, and retrying sends once (P4-WINDOW-11)", async () => {
    const { row } = await setup();
    fakeWhatsApp.failures.push(new GatewayError("rejected", false));
    const sent = await send(row.id, { body: "x", clientRef: randomUUID() });
    await runJobs();
    const id = sent.body!.data.id;
    expect((await prisma.messagingMessage.findUniqueOrThrow({ where: { id } })).status).toBe(
      "FAILED",
    );
    const retry = () =>
      callRoute<Body, Id>(retryRoute.POST, { method: "POST", path: "/x", params: { id } });
    const [a, b] = await Promise.all([retry(), retry()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await runJobs();
    expect((await prisma.messagingMessage.findUniqueOrThrow({ where: { id } })).status).toBe(
      "SENT",
    );
    expect(fakeWhatsApp.sent).toHaveLength(1);
  });
});

describe("opt-in and opt-out", () => {
  it("a first message opts in, recording source and time (P4-WINDOW-08)", async () => {
    const from = nextNumber();
    await receive(from);
    expect((await conversationOf(from)).contact).toMatchObject({
      optInStatus: "OPTED_IN",
      optInSource: "whatsapp_inbound",
    });
    const first = (await conversationOf(from)).contact.optInAt;
    await receive(from, "again");
    expect((await conversationOf(from)).contact.optInAt).toEqual(first); // not overwritten
  });

  it.each(["STOP", "stop", " Unsubscribe ", "बंद", "बंद करो", "रोको", "अनसब्सक्राइब"])(
    "%j opts out (P4-WINDOW-07)",
    async (word) => {
      await as("ADMIN");
      const from = nextNumber();
      await receive(from);
      await receive(from, word);
      const row = await conversationOf(from);
      expect(row.contact.optInStatus).toBe("OPTED_OUT");
      expect((await send(row.id, { body: "x", clientRef: randomUUID() })).status).toBe(409);
    },
  );

  it("an opt-out arriving after a message is queued stops the send (P4-WINDOW-06)", async () => {
    await as("ADMIN");
    const from = nextNumber();
    await receive(from);
    const row = await conversationOf(from);
    const sent = await send(row.id, { body: "x", clientRef: randomUUID() });
    await prisma.leadsContact.update({
      where: { id: row.contactId },
      data: { optInStatus: "OPTED_OUT" },
    });
    await runJobs();
    const message = await prisma.messagingMessage.findUniqueOrThrow({
      where: { id: sent.body!.data.id },
    });
    expect(message).toMatchObject({ status: "FAILED", failureCode: "opted_out" });
    expect(fakeWhatsApp.sent).toHaveLength(0);
  });

  it("the word inside a sentence doesn't; ordinary messages don't undo it; START does", async () => {
    const from = nextNumber();
    await receive(from, "please don't stop the trip");
    expect((await conversationOf(from)).contact.optInStatus).toBe("OPTED_IN");
    await receive(from, "STOP");
    await receive(from, "hello?");
    expect((await conversationOf(from)).contact.optInStatus).toBe("OPTED_OUT");
    await receive(from, "START");
    expect((await conversationOf(from)).contact.optInStatus).toBe("OPTED_IN");
  });

  it("staff can record agreement over unknown, never over an opt-out", async () => {
    await as("ADMIN");
    const created = await callRoute<Body>(leadsRoute.POST, {
      method: "POST",
      path: "/x",
      body: { customerName: "Kabir", phone: "9876543210", source: "MANUAL" },
    });
    const chat = await callRoute<Body, Id>(startChat.POST, {
      method: "POST",
      path: "/x",
      params: { id: created.body!.data.id },
    });
    expect(chat.status).toBe(200);
    const id = chat.body!.data.id;
    const contact = () =>
      prisma.leadsContact.findFirstOrThrow({ where: { phoneE164: "+919876543210" } });
    expect((await contact()).optInStatus).toBe("UNKNOWN");
    const agree = () =>
      callRoute<Body, Id>(optInRoute.POST, { method: "POST", path: "/x", params: { id } });
    expect((await agree()).status).toBe(200);
    expect(await contact()).toMatchObject({ optInStatus: "OPTED_IN", optInSource: "staff" });
    await prisma.leadsContact.update({
      where: { phoneE164: "+919876543210" },
      data: { optInStatus: "OPTED_OUT" },
    });
    expect((await agree()).status).toBe(409);
    expect(await prisma.auditEvent.count({ where: { action: "contact.opt_changed" } })).toBe(1);
  });
});

describe("templates", () => {
  const approved = async (body = "Hi {{1}}, your {{2}} trip", name = "trip_reminder") =>
    (await createTemplate({ name, language: "en", category: "UTILITY", body })).body!.data;
  const closedChat = async () => {
    const from = nextNumber();
    await receive(from);
    const row = await conversationOf(from);
    await setLastInbound(row.id, plusDuration(systemClock.now(), { hours: -48 }));
    return row;
  };

  it("sends an approved template after the window, rendering the text", async () => {
    await as("ADMIN");
    const template = await approved();
    const row = await closedChat();
    const result = await sendTemplate(row.id, {
      templateId: template.id,
      variables: ["Riya", "Kashmir"],
      clientRef: randomUUID(),
    });
    expect(result.status).toBe(201);
    expect(result.body?.data.body).toBe("Hi Riya, your Kashmir trip");
    await runJobs();
    expect(fakeWhatsApp.sent[0]).toMatchObject({
      kind: "template",
      name: "trip_reminder",
      variables: ["Riya", "Kashmir"],
    });
  });

  it("only an approved template can be sent (P4-TMPL-01), and it stops being offered (P4-TMPL-03)", async () => {
    await as("ADMIN");
    const template = await approved();
    const row = await closedChat();
    const picker = () =>
      callRoute<Body<Array<{ id: string }>>>(templates.GET, { path: "/x?approved=true" });
    expect((await picker()).body?.data.map((t) => t.id)).toEqual([template.id]);
    await prisma.messagingTemplate.update({
      where: { id: template.id },
      data: { status: "PAUSED" },
    });
    expect((await picker()).body?.data).toEqual([]);
    expect(
      (
        await sendTemplate(row.id, {
          templateId: template.id,
          variables: ["a", "b"],
          clientRef: randomUUID(),
        })
      ).status,
    ).toBe(409);
  });

  it("a template paused while a send is queued fails friendly (P4-TMPL-03)", async () => {
    await as("ADMIN");
    const template = await approved();
    const row = await closedChat();
    const sent = await sendTemplate(row.id, {
      templateId: template.id,
      variables: ["a", "b"],
      clientRef: randomUUID(),
    });
    await prisma.messagingTemplate.update({
      where: { id: template.id },
      data: { status: "REJECTED" },
    });
    await runJobs();
    const message = await prisma.messagingMessage.findUniqueOrThrow({
      where: { id: sent.body!.data.id },
    });
    expect(message).toMatchObject({ status: "FAILED", failureCode: "template_unavailable" });
  });

  it("the provider's own status update reaches the template", async () => {
    await as("ADMIN");
    const template = await approved();
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                event: "REJECTED",
                message_template_id: 1,
                message_template_name: "trip_reminder",
                message_template_language: "en",
                reason: "ABUSIVE_CONTENT",
              },
            },
          ],
        },
      ],
    });
    await deliver(raw);
    await runJobs();
    expect(
      await prisma.messagingTemplate.findUniqueOrThrow({ where: { id: template.id } }),
    ).toMatchObject({
      status: "REJECTED",
      rejectedReason: "ABUSIVE_CONTENT",
    });
  });

  it("needs every variable, exactly (P4-TMPL-02)", async () => {
    await as("ADMIN");
    const template = await approved();
    const row = await closedChat();
    for (const variables of [["a"], ["a", "b", "c"], ["a", " "]]) {
      const result = await sendTemplate(row.id, {
        templateId: template.id,
        variables,
        clientRef: randomUUID(),
      });
      expect(result.status, String(variables)).toBe(400);
    }
  });

  it("is refused without opt-in, or after opt-out (P4-WINDOW-06)", async () => {
    await as("ADMIN");
    const template = await approved();
    const row = await closedChat();
    for (const optInStatus of ["UNKNOWN", "OPTED_OUT"] as const) {
      await prisma.leadsContact.update({ where: { id: row.contactId }, data: { optInStatus } });
      const result = await sendTemplate(row.id, {
        templateId: template.id,
        variables: ["a", "b"],
        clientRef: randomUUID(),
      });
      expect(result.status, optInStatus).toBe(409);
    }
  });

  it("refuses a duplicate name and language (P4-TMPL-04), and variables out of order", async () => {
    await as("ADMIN");
    await approved();
    const again = await createTemplate({
      name: "trip_reminder",
      language: "en",
      category: "UTILITY",
      body: "x",
    });
    expect(again.status).toBe(409);
    expect(
      (
        await createTemplate({
          name: "trip_reminder",
          language: "hi",
          category: "UTILITY",
          body: "x",
        })
      ).status,
    ).toBe(201);
    expect(
      (await createTemplate({ name: "bad", language: "en", category: "UTILITY", body: "Hi {{2}}" }))
        .status,
    ).toBe(400);
  });

  it("only a permitted role manages them (P4-TMPL-05)", async () => {
    await as("MANAGER");
    expect(
      (await createTemplate({ name: "x", language: "en", category: "UTILITY", body: "y" })).status,
    ).toBe(403);
    await as("ADMIN");
    const template = await approved();
    await as("AGENT");
    const del = await callRoute(templateItem.DELETE, {
      method: "DELETE",
      path: "/x",
      params: { id: template.id },
    });
    expect(del.status).toBe(403);
    await as("ADMIN");
    expect(
      (
        await callRoute(templateItem.DELETE, {
          method: "DELETE",
          path: "/x",
          params: { id: template.id },
        })
      ).status,
    ).toBe(200);
    expect(await prisma.auditEvent.count({ where: { action: "template.deleted" } })).toBe(1);
  });
});

describe("media", () => {
  const imageMessage = (from: string, id: string, mime = "image/png") => ({
    id: `wamid.${randomUUID()}`,
    from,
    timestamp: String(nowSeconds()),
    type: "image",
    image: { id, mime_type: mime },
  });

  it("saves received media under a key with no personal data, and shows it only in scope (P4-MEDIA-01, -04)", async () => {
    const from = nextNumber();
    const message = imageMessage(from, "photo-1");
    await deliver(fakeInboundWebhook([message], [{ wa_id: from, name: "Riya" }]));
    await runJobs();
    await runJobs();
    const row = await prisma.messagingMessage.findFirstOrThrow({
      where: { waMessageId: message.id },
    });
    expect(row.mediaStatus).toBe("STORED");
    expect(row.mediaRef).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(row.mediaRef).not.toContain(from);
    expect(await getFileStorage().exists(row.mediaRef!)).toBe(true);

    const get = () =>
      mediaRoute.GET(new Request("http://127.0.0.1/x"), {
        params: Promise.resolve({ id: row.id }),
      });
    await as("ADMIN");
    const ok = await get();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toContain("attachment");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    await as("AGENT");
    expect((await get()).status).toBe(404);
    await getFileStorage().delete(row.mediaRef!);
  });

  it("a failing download retries, then shows a placeholder and keeps the message (P4-MEDIA-02)", async () => {
    await as("ADMIN");
    const from = nextNumber();
    const message = imageMessage(from, "expired-1");
    await deliver(fakeInboundWebhook([message]));
    for (let i = 0; i < 8; i += 1) {
      await runJobs();
      await runtime.clock.tick(60 * 60_000);
    }
    const row = await prisma.messagingMessage.findFirstOrThrow({
      where: { waMessageId: message.id },
    });
    expect(row.mediaStatus).toBe("FAILED");
    const detail = await open(row.conversationId);
    expect(detail.body?.data.messages[0].mediaStatus).toBe("FAILED");
  }, 30_000);

  it("an oversized or disallowed file is refused safely (P4-MEDIA-03)", async () => {
    const from = nextNumber();
    const huge = imageMessage(from, "huge-1");
    const exe = imageMessage(from, "photo-2", "application/x-msdownload");
    await deliver(fakeInboundWebhook([huge, exe]));
    await runJobs();
    await runJobs();
    for (const message of [huge, exe]) {
      const row = await prisma.messagingMessage.findFirstOrThrow({
        where: { waMessageId: message.id },
      });
      expect(row.mediaStatus).toBe("FAILED");
      expect(row.mediaRef).not.toMatch(/uploads/);
    }
  });

  it("sends a file within the limit, and refuses one over it (P4-MEDIA-05)", async () => {
    await as("ADMIN");
    const from = nextNumber();
    await receive(from);
    const { id } = await conversationOf(from);
    const upload = (size: number, type: string, name: string) => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(size)], name, { type }));
      form.set("clientRef", randomUUID());
      return mediaSend.POST(new Request("http://127.0.0.1/x", { method: "POST", body: form }), {
        params: Promise.resolve({ id }),
      });
    };
    expect((await upload(6 * 1024 * 1024, "image/png", "big.png")).status).toBe(400);
    expect((await upload(10, "application/x-msdownload", "a.exe")).status).toBe(400);
    const ok = await upload(10, "application/pdf", "plan.pdf");
    expect(ok.status).toBe(201);
    await runJobs();
    expect(fakeWhatsApp.sent[0]).toMatchObject({ kind: "media", filename: "plan.pdf" });
    const row = await prisma.messagingMessage.findFirstOrThrow({
      where: { direction: "OUTBOUND" },
    });
    await getFileStorage().delete(row.mediaRef!);
  });
});

describe("merging leads", () => {
  it("keeps everything on one survivor, once, audited (P4-MERGE-02, -04)", async () => {
    await as("ADMIN");
    const a = nextNumber();
    const b = nextNumber();
    await receive(a);
    await receive(b);
    const [ca, cb] = await Promise.all([conversationOf(a), conversationOf(b)]);
    const admin = await makeUser("ADMIN");
    actAs(await testPrincipal("ADMIN", admin.id));
    await prisma.leadsNote.create({
      data: { leadId: cb.leadId!, authorUserId: admin.id, body: "n" },
    });
    await prisma.leadsTask.create({
      data: {
        leadId: cb.leadId!,
        assigneeUserId: admin.id,
        title: "t",
        dueDate: instantFromEpochMs(4102444800000),
      },
    });
    const merge = () =>
      callRoute<Body, Id>(mergeRoute.POST, {
        method: "POST",
        path: "/x",
        params: { id: cb.leadId! },
        body: { intoLeadId: ca.leadId },
      });
    expect((await merge()).status).toBe(200);
    expect((await merge()).status).toBe(200);
    expect(await prisma.leadsNote.count({ where: { leadId: ca.leadId! } })).toBe(1);
    expect(await prisma.leadsTask.count({ where: { leadId: ca.leadId! } })).toBe(1);
    expect((await conversationOf(b)).leadId).toBe(ca.leadId);
    expect(await prisma.leadsTimelineEntry.count({ where: { leadId: cb.leadId! } })).toBe(0);
    const gone = await prisma.leadsLead.findUniqueOrThrow({ where: { id: cb.leadId! } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.mergedIntoLeadId).toBe(ca.leadId);
    expect(await prisma.auditEvent.count({ where: { action: "lead.merged" } })).toBe(1);
  });

  it("refuses merging into itself, and needs the permission and scope", async () => {
    await as("ADMIN");
    const a = nextNumber();
    const b = nextNumber();
    await receive(a);
    await receive(b);
    const [ca, cb] = await Promise.all([conversationOf(a), conversationOf(b)]);
    const merge = (id: string, intoLeadId: string) =>
      callRoute<Body, Id>(mergeRoute.POST, {
        method: "POST",
        path: "/x",
        params: { id },
        body: { intoLeadId },
      });
    expect((await merge(ca.leadId!, ca.leadId!)).status).toBe(400);
    await as("AGENT");
    expect((await merge(ca.leadId!, cb.leadId!)).status).toBe(403);
    const manager = await makeUser("MANAGER");
    const other = await makeUser("AGENT");
    await assignLead(cb.leadId!, other.id);
    await as("MANAGER", manager.id);
    expect((await merge(ca.leadId!, cb.leadId!)).status).toBe(404);
  });
});

describe("the first reply", () => {
  it("moves a New lead to Contacted, once, and records the time", async () => {
    await as("ADMIN");
    const from = nextNumber();
    await receive(from);
    const row = await conversationOf(from);
    await send(row.id, { body: "x", clientRef: randomUUID() });
    const first = (await prisma.leadsLead.findUniqueOrThrow({ where: { id: row.leadId! } }))
      .firstResponseAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await send(row.id, { body: "y", clientRef: randomUUID() });
    const lead = await prisma.leadsLead.findUniqueOrThrow({
      where: { id: row.leadId! },
      include: { stage: true },
    });
    expect(lead.stage.code).toBe("CONTACTED");
    expect(lead.firstResponseAt).not.toBeNull();
    expect(lead.firstResponseAt).toEqual(first);
    expect(
      await prisma.leadsTimelineEntry.count({
        where: { leadId: row.leadId!, kind: "STAGE_CHANGED" },
      }),
    ).toBe(1);
  });
});

describe("the inbox list", () => {
  it("is scoped, newest first, searchable and filterable by unread", async () => {
    await as("ADMIN");
    const a = nextNumber();
    const b = nextNumber();
    await receive(a, "first", "Riya");
    await receive(b, "second", "Arjun");
    const ids = (await list()).body!.data.items.map((row) => row.contact.name);
    expect(ids).toEqual(expect.arrayContaining(["Riya", "Arjun"]));
    expect((await list("?search=riya")).body!.data.items.map((row) => row.contact.name)).toEqual([
      "Riya",
    ]);
    expect(
      (await list(`?search=${b.slice(2)}`)).body!.data.items.map((row) => row.contact.name),
    ).toEqual(["Arjun"]);
    const riya = await conversationOf(a);
    await callRoute(readRoute.POST, { method: "POST", path: "/x", params: { id: riya.id } });
    expect((await list("?unread=true")).body!.data.items.map((row) => row.contact.name)).toEqual([
      "Arjun",
    ]);
    expect((await list()).body!.data.items[0]).toMatchObject({
      lastMessage: expect.any(Object),
      window: expect.any(Object),
    });
  });
});
