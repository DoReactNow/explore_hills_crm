// P11-SEC-01: another person's records, reached by changing an ID in the address. Each route is called
// by an agent who owns nothing here, then by the real owner, so a broken route can't pass by failing
// for everyone. Adding an ID route to the list is the job of whoever adds the route.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as callAnswer from "@/app/api/telephony/calls/[id]/answer/route";
import * as callDecline from "@/app/api/telephony/calls/[id]/decline/route";
import * as callEnd from "@/app/api/telephony/calls/[id]/end/route";
import * as callOutcome from "@/app/api/telephony/calls/[id]/outcome/route";
import * as callRecording from "@/app/api/telephony/calls/[id]/recording/route";
import * as callItem from "@/app/api/telephony/calls/[id]/route";
import * as chatMedia from "@/app/api/conversations/[id]/media/route";
import * as chatMessages from "@/app/api/conversations/[id]/messages/route";
import * as chatOptIn from "@/app/api/conversations/[id]/opt-in/route";
import * as chatRead from "@/app/api/conversations/[id]/read/route";
import * as chatItem from "@/app/api/conversations/[id]/route";
import * as chatTemplate from "@/app/api/conversations/[id]/template/route";
import * as leadCalls from "@/app/api/leads/[id]/calls/route";
import * as leadChat from "@/app/api/leads/[id]/conversation/route";
import * as leadNotes from "@/app/api/leads/[id]/notes/route";
import * as leadItem from "@/app/api/leads/[id]/route";
import * as leadStage from "@/app/api/leads/[id]/stage/route";
import * as leadTask from "@/app/api/leads/[id]/tasks/[taskId]/route";
import * as leadTasks from "@/app/api/leads/[id]/tasks/route";
import * as messageMedia from "@/app/api/messages/[id]/media/route";
import * as messageRetry from "@/app/api/messages/[id]/retry/route";
import * as noteRead from "@/app/api/notifications/[id]/read/route";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { getPrisma } from "@/shared/db/prisma";
import { systemClock } from "@/shared/time";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";

const prisma = getPrisma();
type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

let owner: string;
let stranger: string;
let lead: string;
let task: string;
let chat: string;
let message: string;
let call: string;
let notification: string;

async function makeAgent() {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
  const user = await prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Agent",
      passwordHash: "h",
      roleId: role.id,
    },
  });
  return user.id;
}

beforeAll(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
  owner = await makeAgent();
  stranger = await makeAgent();
  const now = systemClock.now();
  const stage = await prisma.leadsPipelineStage.findFirstOrThrow({ where: { code: "NEW" } });
  const contact = await prisma.leadsContact.create({
    data: { phoneE164: "+919812340001", name: "Private Customer" },
  });
  lead = (
    await prisma.leadsLead.create({
      data: { contactId: contact.id, stageId: stage.id, ownerUserId: owner },
    })
  ).id;
  task = (
    await prisma.leadsTask.create({
      data: {
        leadId: lead,
        assigneeUserId: owner,
        title: "Private follow-up",
        dueDate: now,
      },
    })
  ).id;
  chat = (
    await prisma.messagingConversation.create({
      data: {
        businessPhoneNumberId: "biz",
        waId: "919812340001",
        contactId: contact.id,
        leadId: lead,
      },
    })
  ).id;
  message = (
    await prisma.messagingMessage.create({
      data: {
        conversationId: chat,
        direction: "OUTBOUND",
        type: "TEXT",
        body: "Private words",
        status: "FAILED",
        clientRef: "owner-message",
        occurredAt: now,
      },
    })
  ).id;
  call = (
    await prisma.telephonyCall.create({
      data: {
        providerKey: "fake",
        callRef: randomUUID(),
        status: "COMPLETED",
        customerPhoneE164: "+919812340001",
        agentUserId: owner,
        leadId: lead,
        startedAt: now,
      },
    })
  ).id;
  notification = (
    await prisma.notificationsNotification.create({
      data: {
        userId: owner,
        kind: "lead_assigned",
        title: "Private",
        body: "Private",
        createdAt: now,
      },
    })
  ).id;
});

afterAll(stopActing);

interface Attempt {
  name: string;
  method: string;
  handler: unknown;
  params: () => Record<string, string>;
  body?: unknown;
  /** Owner can read it too, proving the refusal is about who asks. */
  ownerGets200?: boolean;
}

const leadParams = () => ({ id: lead });
const chatParams = () => ({ id: chat });
const callParams = () => ({ id: call });
const clientRef = "attack-ref";
const OUTCOME = "INTERESTED";

const ATTEMPTS: Attempt[] = [
  {
    name: "read a lead",
    method: "GET",
    handler: leadItem.GET,
    params: leadParams,
    ownerGets200: true,
  },
  {
    name: "edit a lead",
    method: "PATCH",
    handler: leadItem.PATCH,
    params: leadParams,
    body: { customerName: "Hacked", version: "2026-11-01T00:00:00.000Z" },
  },
  { name: "delete a lead", method: "DELETE", handler: leadItem.DELETE, params: leadParams },
  {
    name: "add a note",
    method: "POST",
    handler: leadNotes.POST,
    params: leadParams,
    body: { body: "Hacked" },
  },
  {
    name: "move a stage",
    method: "POST",
    handler: leadStage.POST,
    params: leadParams,
    body: { stageCode: "NEW" },
  },
  {
    name: "add a follow-up",
    method: "POST",
    handler: leadTasks.POST,
    params: leadParams,
    body: { title: "Hacked", dueDate: "2027-01-01" },
  },
  {
    name: "finish a follow-up",
    method: "PATCH",
    handler: leadTask.PATCH,
    params: () => ({ id: lead, taskId: task }),
    body: { completed: true },
  },
  {
    name: "list a lead's calls",
    method: "GET",
    handler: leadCalls.GET,
    params: leadParams,
    ownerGets200: true,
  },
  {
    name: "call a lead",
    method: "POST",
    handler: leadCalls.POST,
    params: leadParams,
    body: { clientRef: randomUUID() },
  },
  {
    name: "find a lead's chat",
    method: "GET",
    handler: leadChat.GET,
    params: leadParams,
    ownerGets200: true,
  },
  { name: "start a lead's chat", method: "POST", handler: leadChat.POST, params: leadParams },
  {
    name: "read a chat",
    method: "GET",
    handler: chatItem.GET,
    params: chatParams,
    ownerGets200: true,
  },
  {
    name: "read older messages",
    method: "GET",
    handler: chatMessages.GET,
    params: chatParams,
    ownerGets200: true,
  },
  {
    name: "send a message",
    method: "POST",
    handler: chatMessages.POST,
    params: chatParams,
    body: { body: "Hacked", clientRef },
  },
  {
    name: "send a template",
    method: "POST",
    handler: chatTemplate.POST,
    params: chatParams,
    body: { templateId: randomUUID(), variables: [], clientRef },
  },
  { name: "record agreement", method: "POST", handler: chatOptIn.POST, params: chatParams },
  { name: "mark a chat read", method: "POST", handler: chatRead.POST, params: chatParams },
  {
    name: "open a message's file",
    method: "GET",
    handler: messageMedia.GET,
    params: () => ({ id: message }),
  },
  {
    name: "retry a message",
    method: "POST",
    handler: messageRetry.POST,
    params: () => ({ id: message }),
  },
  {
    name: "read a call",
    method: "GET",
    handler: callItem.GET,
    params: callParams,
    ownerGets200: true,
  },
  { name: "decline a call", method: "POST", handler: callDecline.POST, params: callParams },
  {
    name: "end a call",
    method: "POST",
    handler: callEnd.POST,
    params: callParams,
    body: { reason: "hangup" },
  },
  {
    name: "write a call outcome",
    method: "POST",
    handler: callOutcome.POST,
    params: callParams,
    body: { outcome: OUTCOME },
  },
  { name: "play a recording", method: "GET", handler: callRecording.GET, params: callParams },
];

describe("an agent changing an ID", () => {
  it.each(ATTEMPTS)("cannot $name", async ({ method, handler, params, body }) => {
    actAs(await testPrincipal("AGENT", stranger));
    const result = await callRoute(handler as Handler, {
      method,
      path: "/x",
      params: params() as never,
      body,
    });
    expect([403, 404]).toContain(result.status);
    // The answer gives nothing away: no customer, no message, no permission code.
    expect(JSON.stringify(result.body)).not.toMatch(/Private|919812340001/);
  });

  it.each(ATTEMPTS.filter((attempt) => attempt.ownerGets200))(
    "while the owner can $name",
    async ({ method, handler, params }) => {
      actAs(await testPrincipal("AGENT", owner));
      const result = await callRoute(handler as Handler, {
        method,
        path: "/x",
        params: params() as never,
      });
      expect(result.status).toBe(200);
    },
  );

  it("cannot answer a call ringing for someone else", async () => {
    const ringing = await prisma.telephonyCall.create({
      data: {
        providerKey: "fake",
        callRef: randomUUID(),
        status: "RINGING_AGENT",
        customerPhoneE164: "+919812340001",
        agentUserId: owner,
        leadId: lead,
        startedAt: systemClock.now(),
      },
    });
    actAs(await testPrincipal("AGENT", stranger));
    const result = await callRoute(callAnswer.POST as Handler, {
      method: "POST",
      path: "/x",
      params: { id: ringing.id } as never,
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    const row = await prisma.telephonyCall.findUniqueOrThrow({ where: { id: ringing.id } });
    expect(row.agentUserId).toBe(owner);
    expect(row.answeredAt).toBeNull();
  });

  it("as a manager of nobody here, cannot read the lead either", async () => {
    actAs(await testPrincipal("MANAGER", stranger));
    const result = await callRoute(leadItem.GET as Handler, {
      method: "GET",
      path: "/x",
      params: { id: lead } as never,
    });
    expect([403, 404]).toContain(result.status);
  });

  it("cannot mark someone else's notification read", async () => {
    actAs(await testPrincipal("AGENT", stranger));
    await callRoute(noteRead.POST as Handler, {
      method: "POST",
      path: "/x",
      params: { id: notification } as never,
    });
    const row = await prisma.notificationsNotification.findUniqueOrThrow({
      where: { id: notification },
    });
    expect(row.readAt).toBeNull();
  });

  it("left the owner's records as they were", async () => {
    const row = await prisma.leadsLead.findUniqueOrThrow({ where: { id: lead } });
    expect(row.deletedAt).toBeNull();
    expect(await prisma.leadsNote.count({ where: { leadId: lead } })).toBe(0);
    expect(await prisma.messagingMessage.count({ where: { conversationId: chat } })).toBe(1);
  });

  it("cannot see another chat's message by reusing its client reference", async () => {
    const strangerContact = await prisma.leadsContact.create({
      data: { phoneE164: "+919812340002", name: "Own Customer" },
    });
    const stage = await prisma.leadsPipelineStage.findFirstOrThrow({ where: { code: "NEW" } });
    const ownLead = await prisma.leadsLead.create({
      data: { contactId: strangerContact.id, stageId: stage.id, ownerUserId: stranger },
    });
    const ownChat = await prisma.messagingConversation.create({
      data: {
        businessPhoneNumberId: "biz",
        waId: "919812340002",
        contactId: strangerContact.id,
        leadId: ownLead.id,
        lastInboundAt: systemClock.now(),
      },
    });
    actAs(await testPrincipal("AGENT", stranger));
    const send = await callRoute(chatMessages.POST as Handler, {
      method: "POST",
      path: "/x",
      params: { id: ownChat.id } as never,
      body: { body: "Mine", clientRef: "owner-message" },
    });
    expect(JSON.stringify(send.body)).not.toContain("Private words");
    const form = new FormData();
    form.set("file", new File(["x"], "a.jpg", { type: "image/jpeg" }));
    form.set("clientRef", "owner-message");
    const upload = await (chatMedia.POST as Handler)(
      new Request("http://127.0.0.1/x", { method: "POST", body: form }),
      { params: Promise.resolve({ id: ownChat.id }) as never },
    );
    expect(await upload.text()).not.toContain("Private words");
  });
});
