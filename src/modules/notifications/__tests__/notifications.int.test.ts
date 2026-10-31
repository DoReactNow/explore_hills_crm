// Phase 8: notifications and SLA, against real Postgres with the fake channels.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { businessDateToDbDate, createTestClock, parseBusinessLocalDateTime } from "@/shared/time";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { fakeChannels, fakeEmail, fakePush } from "../channels/fake";
import { createNotificationService } from "../notifications.service";

const prisma = getPrisma();
const NOON = parseBusinessLocalDateTime("2026-11-02", "12:00"); // a Monday
const MINUTE = 60_000;
let clock: ReturnType<typeof createTestClock>;
let service: ReturnType<typeof createNotificationService>;
let counter = 0;

async function makeUser(
  roleCode = "AGENT",
  options: { managerId?: string; status?: "ACTIVE" | "DEACTIVATED" } = {},
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: `${roleCode} ${++counter}`,
      passwordHash: "h",
      status: options.status ?? "ACTIVE",
      roleId: role.id,
      managerId: options.managerId,
    },
  });
}
const ctx = async (id: string, role = "AGENT") => ({ principal: await testPrincipal(role, id) });
async function makeLead(ownerUserId?: string, createdAt = NOON) {
  const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
  const contact = await prisma.leadsContact.create({
    data: { phoneE164: `+9198${String(60000000 + ++counter)}`, name: "Asha" },
  });
  return prisma.leadsLead.create({
    data: { contactId: contact.id, stageId: stage.id, ownerUserId, createdAt },
  });
}
const send = (
  userId: string,
  key: string = randomUUID(),
  kind: "lead_assigned" | "blast_offer" = "lead_assigned",
) => service.notify({ userIds: [userId], kind, key, body: "Asha · Goa", link: "/leads/x" });
const rowsOf = (userId: string) => prisma.notificationsNotification.findMany({ where: { userId } });

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
  fakeChannels.reset();
  clock = createTestClock(NOON.toISOString());
  service = createNotificationService({
    clock,
    enqueue: false,
    email: () => fakeEmail,
    push: () => fakePush,
  });
});
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("notifications", () => {
  it("reaches only the intended person (P8-NOTIF-01)", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    await send(me.id);
    expect((await service.list(await ctx(me.id), { unread: false, page: 1 })).items).toHaveLength(
      1,
    );
    expect(
      (await service.list(await ctx(other.id), { unread: false, page: 1 })).items,
    ).toHaveLength(0);
  });

  it("marks read safely, and the count stays right (P8-NOTIF-02)", async () => {
    const me = await makeUser();
    await send(me.id, "a", "lead_assigned");
    await send(me.id, "b", "blast_offer");
    const context = await ctx(me.id);
    const { items, unreadCount } = await service.list(context, { unread: true, page: 1 });
    expect(unreadCount).toBe(2);
    await service.markRead(context, items[0].id);
    await service.markRead(context, items[0].id);
    expect((await service.list(context, { unread: true, page: 1 })).unreadCount).toBe(1);
    await service.markAllRead(context);
    await service.markAllRead(context);
    expect((await service.list(context, { unread: true, page: 1 })).unreadCount).toBe(0);
  });

  it("can't mark someone else's as read", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    await send(me.id);
    const [row] = await rowsOf(me.id);
    await service.markRead(await ctx(other.id), row.id);
    expect((await rowsOf(me.id))[0].readAt).toBeNull();
  });

  it("makes one notification for one event, even delivered twice at once (P8-NOTIF-03)", async () => {
    const me = await makeUser();
    await Promise.all([send(me.id, "same"), send(me.id, "same"), send(me.id, "same")]);
    const rows = await rowsOf(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].groupCount).toBe(1);
  });

  it("skips a deactivated person (P8-NOTIF-05)", async () => {
    const gone = await makeUser("AGENT", { status: "DEACTIVATED" });
    await send(gone.id);
    expect(await rowsOf(gone.id)).toHaveLength(0);
  });

  it("joins like events within five minutes, and starts afresh after (P8-NOTIF-08)", async () => {
    const me = await makeUser();
    await send(me.id);
    clock.advance(MINUTE);
    await send(me.id);
    await send(me.id);
    let rows = await rowsOf(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      groupCount: 3,
      title: "3 new leads were assigned to you",
      link: "/leads",
    });
    clock.advance(6 * MINUTE);
    await send(me.id);
    rows = await rowsOf(me.id);
    expect(rows).toHaveLength(2);
  });

  it("doesn't join a new event to one already read", async () => {
    const me = await makeUser();
    await send(me.id);
    await service.markAllRead(await ctx(me.id));
    await send(me.id);
    expect(await rowsOf(me.id)).toHaveLength(2);
  });

  it("doesn't let a repeat of a grouped event count twice", async () => {
    const me = await makeUser();
    await send(me.id, "a");
    await send(me.id, "b");
    await send(me.id, "a");
    expect((await rowsOf(me.id))[0].groupCount).toBe(2);
  });
});

describe("choices (Q-17)", () => {
  it("are refused for an agent, and allowed for a manager", async () => {
    const [agent, manager] = [await makeUser(), await makeUser("MANAGER")];
    const off = { inApp: false, email: false, push: false };
    const refused = await service
      .setPreferences(await ctx(agent.id), off)
      .catch((error: unknown) => error);
    expect((refused as AppError).code).toBe("FORBIDDEN");
    await service.setPreferences(await ctx(manager.id, "MANAGER"), off);
    await send(manager.id);
    expect(await rowsOf(manager.id)).toHaveLength(0);
    await send(agent.id);
    expect(await rowsOf(agent.id)).toHaveLength(1);
  });

  it("keeps email on while the app list is off", async () => {
    const manager = await makeUser("MANAGER");
    await service.setPreferences(await ctx(manager.id, "MANAGER"), {
      inApp: false,
      email: true,
      push: false,
    });
    await send(manager.id);
    const [row] = await rowsOf(manager.id);
    expect(row.readAt).not.toBeNull();
    await service.sendEmail(row.id);
    expect(fakeChannels.emails).toHaveLength(1);
  });
});

describe("email and push", () => {
  it("sends the text and a full link, with nothing secret (P8-NOTIF-06)", async () => {
    const me = await makeUser();
    await send(me.id);
    const [row] = await rowsOf(me.id);
    await service.sendEmail(row.id);
    expect(fakeChannels.emails[0]).toMatchObject({
      to: me.email,
      subject: "A lead was assigned to you",
    });
    expect(fakeChannels.emails[0].text).toContain("/leads/x");
    expect(fakeChannels.emails[0].text).not.toMatch(/passwordHash|token|secret/i);
  });

  it("retries an outage, but a bad address doesn't block anyone else (P8-NOTIF-06)", async () => {
    const [bad, good] = [await makeUser(), await makeUser()];
    await send(bad.id);
    await send(good.id);
    const [badRow] = await rowsOf(bad.id);
    const [goodRow] = await rowsOf(good.id);
    fakeChannels.failures.emailTo.add(bad.email);
    await expect(service.sendEmail(badRow.id)).resolves.toBeUndefined();
    await service.sendEmail(goodRow.id);
    expect(fakeChannels.emails.map((mail) => mail.to)).toEqual([good.email]);
    fakeChannels.failures.emailOutage = true;
    await expect(service.sendEmail(goodRow.id)).rejects.toThrow("down");
  });

  it("removes an expired subscription and still reaches the others (P8-NOTIF-07)", async () => {
    const me = await makeUser();
    const context = await ctx(me.id);
    await service.subscribePush(context, { endpoint: "https://push/old", p256dh: "k", auth: "a" });
    await service.subscribePush(context, { endpoint: "https://push/new", p256dh: "k", auth: "a" });
    await send(me.id);
    const [row] = await rowsOf(me.id);
    fakeChannels.failures.expiredEndpoints.add("https://push/old");
    await service.sendPush(row.id);
    expect(fakeChannels.pushes.map((p) => p.endpoint)).toEqual(["https://push/new"]);
    const left = await prisma.notificationsPushSubscription.findMany();
    expect(left.map((s) => s.endpoint)).toEqual(["https://push/new"]);
  });
});

describe("first-reply clocks", () => {
  const kinds = async (userId: string) => (await rowsOf(userId)).map((row) => row.kind);

  it("tells the owner just after the deadline, not at it (P8-SLA-02)", async () => {
    const owner = await makeUser();
    await makeLead(owner.id);
    clock.advance(15 * MINUTE);
    await service.checkFirstResponses();
    expect(await kinds(owner.id)).toEqual([]);
    clock.advance(1);
    await service.checkFirstResponses();
    expect(await kinds(owner.id)).toEqual(["sla_missed"]);
  });

  it("stops at a first response (P8-SLA-01)", async () => {
    const owner = await makeUser();
    const lead = await makeLead(owner.id);
    await prisma.leadsLead.update({ where: { id: lead.id }, data: { firstResponseAt: NOON } });
    clock.advance(60 * MINUTE);
    await service.checkFirstResponses();
    expect(await kinds(owner.id)).toEqual([]);
  });

  it("doesn't fire for a closed or deleted lead (P8-SLA-03)", async () => {
    const owner = await makeUser();
    const closed = await makeLead(owner.id);
    await prisma.leadsLead.update({ where: { id: closed.id }, data: { closedAt: NOON } });
    const deleted = await makeLead(owner.id);
    await prisma.leadsLead.update({ where: { id: deleted.id }, data: { deletedAt: NOON } });
    clock.advance(60 * MINUTE);
    await service.checkFirstResponses();
    expect(await kinds(owner.id)).toEqual([]);
  });

  it("keeps the customer's clock on reassigning, and tells the new owner (P8-SLA-04)", async () => {
    const [first, second] = [await makeUser(), await makeUser()];
    const lead = await makeLead(first.id);
    clock.advance(16 * MINUTE);
    await service.checkFirstResponses();
    await prisma.leadsLead.update({ where: { id: lead.id }, data: { ownerUserId: second.id } });
    await service.checkFirstResponses();
    expect(await kinds(second.id)).toEqual(["sla_missed"]);
    expect(await kinds(first.id)).toEqual(["sla_missed"]);
  });

  it("doesn't run overnight: an evening lead falls due next morning (P8-SLA-06)", async () => {
    const owner = await makeUser();
    clock.set(parseBusinessLocalDateTime("2026-11-02", "22:00"));
    await makeLead(owner.id, clock.now());
    clock.set(parseBusinessLocalDateTime("2026-11-03", "09:00"));
    await service.checkFirstResponses();
    expect(await kinds(owner.id)).toEqual([]);
    clock.set(parseBusinessLocalDateTime("2026-11-03", "10:16"));
    await service.checkFirstResponses();
    expect(await kinds(owner.id)).toEqual(["sla_missed"]);
  });

  it("stops on a holiday (P8-SLA-06)", async () => {
    await prisma.systemSetting.create({ data: { key: "sla.holidays", value: "2026-11-03" } });
    const owner = await makeUser();
    clock.set(parseBusinessLocalDateTime("2026-11-02", "22:00"));
    await makeLead(owner.id, clock.now());
    clock.set(parseBusinessLocalDateTime("2026-11-03", "18:00"));
    await service.checkFirstResponses();
    expect(await kinds(owner.id)).toEqual([]);
  });

  it("escalates once to the managers above (P8-SLA-07)", async () => {
    const top = await makeUser("MANAGER");
    const manager = await makeUser("MANAGER", { managerId: top.id });
    const owner = await makeUser("AGENT", { managerId: manager.id });
    await makeLead(owner.id);
    clock.advance(31 * MINUTE);
    await service.checkFirstResponses();
    await service.checkFirstResponses();
    expect(await kinds(manager.id)).toEqual(["sla_escalated"]);
    expect(await kinds(top.id)).toEqual(["sla_escalated"]);
    expect(await kinds(owner.id)).toEqual(["sla_missed"]);
  });

  it("goes to those who see every lead when the owner has no manager (P8-SLA-07)", async () => {
    const admin = await makeUser("ADMIN");
    const owner = await makeUser();
    await makeLead(owner.id);
    clock.advance(31 * MINUTE);
    await service.checkFirstResponses();
    expect(await kinds(admin.id)).toEqual(["sla_escalated"]);
  });

  it("tells those who can assign about a queue lead", async () => {
    const manager = await makeUser("MANAGER");
    await makeLead();
    clock.advance(16 * MINUTE);
    await service.checkFirstResponses();
    expect(await kinds(manager.id)).toEqual(["sla_missed"]);
  });

  it("doesn't fire twice when a setting changes (P8-SLA-08)", async () => {
    const owner = await makeUser();
    await makeLead(owner.id);
    clock.advance(16 * MINUTE);
    await service.checkFirstResponses();
    await prisma.systemSetting.create({ data: { key: "sla.firstResponseMinutes", value: 5 } });
    await service.checkFirstResponses();
    const rows = await rowsOf(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].groupCount).toBe(1);
  });
});

describe("daily reminders (P8-SLA-05)", () => {
  async function withDue() {
    const owner = await makeUser();
    const lead = await makeLead(owner.id);
    await prisma.leadsTask.create({
      data: {
        leadId: lead.id,
        assigneeUserId: owner.id,
        title: "Call",
        dueDate: businessDateToDbDate("2026-11-02"),
      },
    });
    return { owner, lead };
  }

  it("runs once a day, however many sweeps and restarts", async () => {
    const { owner } = await withDue();
    clock.set(parseBusinessLocalDateTime("2026-11-02", "09:29"));
    await service.sendDailyReminders();
    expect(await rowsOf(owner.id)).toHaveLength(0);
    clock.set(parseBusinessLocalDateTime("2026-11-02", "09:30"));
    await service.sendDailyReminders();
    await service.sendDailyReminders();
    const rows = await rowsOf(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("You have 1 follow-up due or overdue.");
  });

  it("catches up after the worker was down", async () => {
    const { owner } = await withDue();
    clock.set(parseBusinessLocalDateTime("2026-11-02", "15:00"));
    await service.sendDailyReminders();
    expect(await rowsOf(owner.id)).toHaveLength(1);
  });

  it("stays quiet on a closed day or a holiday (P8-SLA-06)", async () => {
    const { owner } = await withDue();
    clock.set(parseBusinessLocalDateTime("2026-11-08", "12:00")); // Sunday
    await service.sendDailyReminders();
    expect(await rowsOf(owner.id)).toHaveLength(0);
    await prisma.systemSetting.create({ data: { key: "sla.holidays", value: "2026-11-09" } });
    clock.set(parseBusinessLocalDateTime("2026-11-09", "12:00"));
    await service.sendDailyReminders();
    expect(await rowsOf(owner.id)).toHaveLength(0);
  });

  it("doesn't count a finished follow-up or a closed lead (P8-SLA-03)", async () => {
    const { owner, lead } = await withDue();
    await prisma.leadsTask.updateMany({ data: { completedAt: NOON } });
    clock.set(parseBusinessLocalDateTime("2026-11-02", "12:00"));
    await service.sendDailyReminders();
    expect(await rowsOf(owner.id)).toHaveLength(0);
    await prisma.leadsTask.updateMany({ data: { completedAt: null } });
    await prisma.leadsLead.update({ where: { id: lead.id }, data: { closedAt: NOON } });
    await service.sendDailyReminders();
    expect(await rowsOf(owner.id)).toHaveLength(0);
  });
});
