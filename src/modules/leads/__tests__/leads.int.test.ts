// Phase 3: leads, contacts, stages, notes, follow-ups and the timeline, through the real API.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as noteRoute from "@/app/api/leads/[id]/notes/route";
import * as stageRoute from "@/app/api/leads/[id]/stage/route";
import * as taskItem from "@/app/api/leads/[id]/tasks/[taskId]/route";
import * as tasksRoute from "@/app/api/leads/[id]/tasks/route";
import * as item from "@/app/api/leads/[id]/route";
import * as collection from "@/app/api/leads/route";
import * as followUps from "@/app/api/follow-ups/route";
import { syncRbac } from "@/modules/identity";
import { getPrisma } from "@/shared/db/prisma";
import {
  businessDateToDbDate,
  createTestClock,
  instantFromEpochMs,
  parseInstant,
} from "@/shared/time";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { ensureDefaultStages } from "..";
import { createLeadService } from "../leads.service";
import { createTaskService } from "../leads.tasks.service";

const prisma = getPrisma();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body<T = Record<string, any>> = {
  data: T;
  error: { code: string; fieldErrors?: Array<{ field: string; message: string }> };
};
type Id = { id: string };

let phoneCounter = 0;
const nextPhone = () => {
  phoneCounter += 1;
  return `+9198${String(10000000 + phoneCounter)}`;
};

async function makeUser(
  roleCode = "AGENT",
  managerId?: string,
  status: "ACTIVE" | "DEACTIVATED" = "ACTIVE",
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: `${roleCode} Person`,
      passwordHash: "hash",
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
const input = (overrides: Record<string, unknown> = {}) => ({
  customerName: "Riya Mehta",
  phone: nextPhone(),
  destination: "Kashmir",
  source: "MANUAL",
  ...overrides,
});
const post = (body: unknown) =>
  callRoute<Body>(collection.POST, { method: "POST", path: "/api/leads", body });
const get = (id: string) => callRoute<Body, Id>(item.GET, { path: "/x", params: { id } });
const list = (query = "") =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callRoute<Body<{ items: Array<Record<string, any>>; total: number; openCount: number }>>(
    collection.GET,
    {
      path: `/api/leads${query}`,
    },
  );
const patch = (id: string, body: unknown) =>
  callRoute<Body, Id>(item.PATCH, { method: "PATCH", path: "/x", params: { id }, body });
const del = (id: string) =>
  callRoute<Body, Id>(item.DELETE, { method: "DELETE", path: "/x", params: { id } });
const moveStage = (id: string, body: unknown) =>
  callRoute<Body, Id>(stageRoute.POST, { method: "POST", path: "/x", params: { id }, body });
const addNote = (id: string, body: unknown) =>
  callRoute<Body, Id>(noteRoute.POST, { method: "POST", path: "/x", params: { id }, body });
const addTask = (id: string, body: unknown) =>
  callRoute<Body, Id>(tasksRoute.POST, { method: "POST", path: "/x", params: { id }, body });
const setTask = (id: string, taskId: string, completed: boolean) =>
  callRoute<Body, { id: string; taskId: string }>(taskItem.PATCH, {
    method: "PATCH",
    path: "/x",
    params: { id, taskId },
    body: { completed },
  });
const createAs = async (ownerId: string) => {
  await as("ADMIN");
  const result = await post(input({ ownerUserId: ownerId }));
  return result.body!.data;
};

beforeEach(async () => {
  stopActing();
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
});
afterEach(() => stopActing());
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("creating a lead", () => {
  it("starts in New with no owner, audited, on the timeline (P3-LEAD-01, -02)", async () => {
    await as("ADMIN");
    const result = await post(input());
    expect(result.status).toBe(201);
    expect(result.body?.data).toMatchObject({ owner: null, stage: { code: "NEW" } });
    expect(await prisma.auditEvent.count({ where: { action: "lead.created" } })).toBe(1);
    const detail = await get(result.body!.data.id);
    expect(detail.body?.data.timeline.map((row: { kind: string }) => row.kind)).toEqual([
      "LEAD_CREATED",
    ]);
  });

  it("an agent owns what they create, so it stays in their list", async () => {
    const agent = await as("AGENT");
    const result = await post(input());
    expect(result.body?.data.owner.id).toBe(agent);
    expect((await list()).body?.data.total).toBe(1);
  });

  it("an agent cannot hand a lead to someone else", async () => {
    const other = await makeUser();
    await as("AGENT");
    expect((await post(input({ ownerUserId: other.id }))).status).toBe(403);
  });

  it("an owner must be active and in scope", async () => {
    const manager = await as("MANAGER");
    const inBranch = await makeUser("AGENT", manager);
    const outside = await makeUser();
    const gone = await makeUser("AGENT", manager, "DEACTIVATED");
    expect((await post(input({ ownerUserId: inBranch.id }))).status).toBe(201);
    expect((await post(input({ ownerUserId: outside.id }))).status).toBe(400);
    expect((await post(input({ ownerUserId: gone.id }))).status).toBe(400);
    expect((await post(input({ ownerUserId: "nope" }))).status).toBe(400);
  });

  it("needs a contact name and a real phone, stored in E.164 (P3-LEAD-03, -04)", async () => {
    await as("ADMIN");
    const bad = await post({ customerName: " ", phone: "12345", source: "MANUAL" });
    expect(bad.status).toBe(400);
    expect(bad.body?.error.fieldErrors?.map((f) => f.field).sort()).toEqual([
      "customerName",
      "phone",
    ]);
    const good = await post(input({ phone: "098765 43210" }));
    expect(good.body?.data.contact.phoneE164).toBe("+919876543210");
    await expect(prisma.leadsContact.create({ data: { phoneE164: "98765" } })).rejects.toThrow();
  });

  it("uses the existing contact for a known phone, in any format (P3-LEAD-06)", async () => {
    await as("ADMIN");
    await post(input({ phone: "+91 90000 00001" }));
    const closing = (await list()).body!.data.items[0];
    await moveStage(closing.id, { stageCode: "WON" });
    await post(input({ phone: "9000000001" }));
    expect(await prisma.leadsContact.count()).toBe(1);
    expect(await prisma.leadsLead.count()).toBe(2);
  });

  it("two requests together for one phone make one contact and one open lead (P3-LEAD-06, -07)", async () => {
    await as("ADMIN");
    const phone = nextPhone();
    const results = await Promise.all([post(input({ phone })), post(input({ phone }))]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await prisma.leadsContact.count()).toBe(1);
    expect(await prisma.leadsLead.count()).toBe(1);
  });

  it("refuses a second open lead, linking to it only if visible (P3-LEAD-07)", async () => {
    const owner = await makeUser();
    const phone = nextPhone();
    const first = await createAs(owner.id);
    const samePhone = first.contact.phoneE164;
    await as("ADMIN");
    const seen = await post(input({ phone: samePhone }));
    expect(seen.status).toBe(409);
    expect(seen.body?.error.fieldErrors?.[0]).toMatchObject({ field: "phone" });
    expect(seen.body?.error.fieldErrors?.[0].message).toContain(first.id);

    await as("AGENT");
    const hidden = await post(input({ phone: samePhone }));
    expect(hidden.status).toBe(409);
    expect(JSON.stringify(hidden.body)).not.toContain(first.id);
    expect(JSON.stringify(hidden.body)).not.toContain("Riya");
    expect(phone).toBeTruthy();
  });

  it("a won or lost customer who returns gets a new linked lead (P3-LEAD-08, Q-05)", async () => {
    await as("ADMIN");
    const first = (await post(input())).body!.data;
    await moveStage(first.id, { stageCode: "LOST", lostReason: "Price too high" });
    const second = await post(input({ phone: first.contact.phoneE164 }));
    expect(second.status).toBe(201);
    expect(second.body?.data.id).not.toBe(first.id);
    const detail = await get(second.body!.data.id);
    expect(detail.body?.data.otherLeads.map((lead: { id: string }) => lead.id)).toEqual([first.id]);
    expect((await get(first.id)).body?.data.stage.code).toBe("LOST");
  });

  it("validates budget, travellers and dates (P3-LEAD-14, -15, -16)", async () => {
    await as("ADMIN");
    for (const budget of ["-1", "1000000001", "12.345", "abc"]) {
      expect((await post(input({ budgetAmount: budget }))).status, budget).toBe(400);
    }
    expect((await post(input({ budgetAmount: "150000.50" }))).body?.data.budgetAmount).toBe(
      "150000.5",
    );
    for (const travellerCount of [0, -2, 1.5, 501]) {
      expect((await post(input({ travellerCount }))).status, String(travellerCount)).toBe(400);
    }
    expect((await post(input({ travellerCount: 4 }))).status).toBe(201);
    expect(
      (await post(input({ travelStartDate: "2026-12-16", travelEndDate: "2026-12-10" }))).status,
    ).toBe(400);
    const oneDay = await post(
      input({ travelStartDate: "2026-12-10", travelEndDate: "2026-12-10" }),
    );
    expect(oneDay.body?.data).toMatchObject({
      travelStartDate: "2026-12-10",
      travelEndDate: "2026-12-10",
    });
    expect((await post(input({ travelStartDate: "2020-01-01" }))).status).toBe(201);
    expect((await post(input({ travelStartDate: "2026-13-45" }))).status).toBe(400);
  });

  it("keeps known custom fields and drops unknown ones (P3-LEAD-17)", async () => {
    await as("ADMIN");
    const result = await post(input({ customFields: { stay: "Houseboat", hacker: "x" } }));
    expect(result.body?.data.customFields).toEqual({ stay: "Houseboat" });
    const row = await prisma.leadsLead.findUniqueOrThrow({ where: { id: result.body!.data.id } });
    await prisma.leadsLead.update({
      where: { id: row.id },
      data: { customFields: { retired: true } },
    });
    expect((await get(row.id)).status).toBe(200); // old leads still open
  });
});

describe("who sees what", () => {
  it("own, team and all, in list, detail and counts (P3-LSCREEN-01, -02)", async () => {
    const manager = await makeUser("MANAGER");
    const agent = await makeUser("AGENT", manager.id);
    const other = await makeUser();
    const mine = await createAs(agent.id);
    const theirs = await createAs(other.id);
    const unassigned = (await post(input())).body!.data;

    await as("AGENT", agent.id);
    let ids = (await list()).body!.data.items.map((lead) => lead.id);
    expect(ids).toEqual([mine.id]);
    expect((await list()).body?.data.total).toBe(1);
    expect((await get(theirs.id)).status).toBe(404);
    expect((await get(unassigned.id)).status).toBe(404);

    await as("MANAGER", manager.id);
    ids = (await list()).body!.data.items.map((lead) => lead.id);
    expect(ids.sort()).toEqual([mine.id, unassigned.id].sort());
    expect((await get(theirs.id)).status).toBe(404);

    await as("ADMIN");
    expect((await list()).body?.data.total).toBe(3);
    await as("SUPER_ADMIN");
    expect((await list()).body?.data.total).toBe(3);
  });

  it("every write is refused out of scope, as not found (P3-LEAD-12)", async () => {
    const other = await makeUser();
    const lead = await createAs(other.id);
    await as("AGENT");
    expect((await patch(lead.id, { destination: "Goa", version: lead.version })).status).toBe(404);
    expect((await moveStage(lead.id, { stageCode: "WON" })).status).toBe(404);
    expect((await addNote(lead.id, { body: "hi" })).status).toBe(404);
    expect((await addTask(lead.id, { title: "x", dueDate: "2099-01-01" })).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
  });

  it("search finds a phone in any format and a name in any case, only in scope (P3-LSCREEN-03)", async () => {
    const owner = await makeUser();
    await as("ADMIN");
    const lead = (
      await post(
        input({ customerName: "Sunita Agarwal", phone: "+91 91234 56789", ownerUserId: owner.id }),
      )
    ).body!.data;
    const find = async (term: string) =>
      (await list(`?search=${encodeURIComponent(term)}`)).body!.data.items.map((row) => row.id);
    for (const term of [
      "91234 56789",
      "9123456789",
      "+919123456789",
      "091234-56789",
      "sunita",
      "AGARWAL",
    ]) {
      expect(await find(term), term).toEqual([lead.id]);
    }
    expect(await find("%")).toEqual([]);
    await as("AGENT");
    expect(await find("sunita")).toEqual([]);
  });

  it("filters and sorts on every column", async () => {
    await as("ADMIN");
    const a = (
      await post(
        input({
          customerName: "Asha",
          destination: "Goa",
          travellerCount: 2,
          budgetAmount: "100",
          travelStartDate: "2027-01-01",
          source: "AD",
        }),
      )
    ).body!.data;
    const b = (
      await post(
        input({
          customerName: "Zoya",
          destination: "Kerala",
          travellerCount: 9,
          budgetAmount: "900",
          travelStartDate: "2027-06-01",
          source: "WEBSITE",
        }),
      )
    ).body!.data;
    await moveStage(b.id, { stageCode: "QUOTED" });
    const first = async (query: string) => (await list(query)).body!.data.items[0].id;
    for (const sort of [
      "customer",
      "destination",
      "travelStartDate",
      "travellerCount",
      "budgetAmount",
    ]) {
      expect(await first(`?sort=${sort}&direction=asc`), sort).toBe(a.id);
      expect(await first(`?sort=${sort}&direction=desc`), sort).toBe(b.id);
    }
    expect(await first("?sort=stage&direction=desc")).toBe(b.id);
    expect((await list("?sort=phone")).status).toBe(200);
    expect((await list("?sort=owner")).status).toBe(200);
    expect((await list("?sort=source")).status).toBe(200);
    expect((await list("?sort=lastActivityAt")).status).toBe(200);
    expect((await list("?sort=nextFollowUpDate")).status).toBe(200);
    expect((await list("?sort=passwordHash")).status).toBe(400);
    expect((await list("?stage=QUOTED")).body?.data.items.map((l) => l.id)).toEqual([b.id]);
    expect((await list("?source=AD")).body?.data.items.map((l) => l.id)).toEqual([a.id]);
    expect((await list("?destination=goa")).body?.data.items.map((l) => l.id)).toEqual([a.id]);
    expect((await list("?owner=unassigned")).body?.data.total).toBe(2);
    expect((await list("?travelFrom=2027-03-01")).body?.data.items.map((l) => l.id)).toEqual([
      b.id,
    ]);
    expect((await list("?travelTo=2027-03-01")).body?.data.items.map((l) => l.id)).toEqual([a.id]);
    expect((await list()).body?.data.openCount).toBe(2);
  });
});

describe("editing", () => {
  it("never changes ownership through the ordinary edit (P3-LEAD-12)", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const lead = await createAs(owner.id);
    await as("ADMIN");
    const result = await patch(lead.id, {
      destination: "Goa",
      ownerUserId: other.id,
      stageId: "x",
      closedAt: "2020-01-01",
      version: lead.version,
    });
    expect(result.status).toBe(200);
    expect(result.body?.data).toMatchObject({
      destination: "Goa",
      owner: { id: owner.id },
      stage: { code: "NEW" },
    });
    expect(await prisma.auditEvent.count({ where: { action: "lead.updated" } })).toBe(1);
  });

  it("two editors from one version: the second is told (P3-LEAD-13)", async () => {
    await as("ADMIN");
    const lead = (await post(input())).body!.data;
    const results = await Promise.all([
      patch(lead.id, { destination: "Goa", version: lead.version }),
      patch(lead.id, { destination: "Kerala", version: lead.version }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it("refuses an end date before a stored start date", async () => {
    await as("ADMIN");
    const lead = (await post(input({ travelStartDate: "2027-01-10" }))).body!.data;
    const result = await patch(lead.id, { travelEndDate: "2027-01-01", version: lead.version });
    expect(result.status).toBe(400);
  });
});

describe("deleting", () => {
  it("only with permission, and it disappears everywhere but history resolves (P3-LEAD-09, -11)", async () => {
    const manager = await makeUser("MANAGER");
    const agent = await makeUser("AGENT", manager.id);
    const lead = await createAs(agent.id);
    await as("MANAGER", manager.id);
    expect((await del(lead.id)).status).toBe(403);
    await as("ADMIN");
    expect((await del(lead.id)).status).toBe(200);
    expect((await get(lead.id)).status).toBe(404);
    expect((await list()).body?.data.total).toBe(0);
    expect(
      (await list(`?search=${encodeURIComponent(lead.contact.phoneE164)}`)).body?.data.total,
    ).toBe(0);
    expect(await prisma.leadsLead.count()).toBe(1); // history
    expect(await prisma.leadsTimelineEntry.count({ where: { leadId: lead.id } })).toBeGreaterThan(
      0,
    );
    expect(await prisma.auditEvent.count({ where: { action: "lead.deleted" } })).toBe(1);
  });

  it("a returning customer after a delete gets a new lead (P3-LEAD-10)", async () => {
    await as("ADMIN");
    const lead = (await post(input())).body!.data;
    await del(lead.id);
    await prisma.leadsContact.update({
      where: { id: lead.contact.id },
      data: { deletedAt: instantFromEpochMs(0) },
    });
    const again = await post(input({ phone: lead.contact.phoneE164 }));
    expect(again.status).toBe(201);
    const contact = await prisma.leadsContact.findUniqueOrThrow({ where: { id: lead.contact.id } });
    expect(contact.deletedAt).toBeNull();
  });
});

describe("stages", () => {
  const start = async () => {
    await as("ADMIN");
    return (await post(input())).body!.data;
  };

  it("audits who, from and to, on the timeline too (P3-STAGE-01)", async () => {
    const lead = await start();
    await moveStage(lead.id, { stageCode: "CONTACTED" });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "lead.stage_changed" },
    });
    expect(event.metadata).toMatchObject({ from: "NEW", to: "CONTACTED" });
    expect(event.actorUserId).not.toBeNull();
    const detail = await get(lead.id);
    expect(detail.body?.data.timeline[0]).toMatchObject({
      kind: "STAGE_CHANGED",
      summary: "Stage changed: New → Contacted",
    });
  });

  it("Lost needs a reason; Won and Lost set the closed time (P3-STAGE-02)", async () => {
    const lead = await start();
    const refused = await moveStage(lead.id, { stageCode: "LOST" });
    expect(refused.status).toBe(400);
    expect(refused.body?.error.fieldErrors?.[0].field).toBe("lostReason");
    const lost = await moveStage(lead.id, { stageCode: "LOST", lostReason: "Price too high" });
    expect(lost.body?.data).toMatchObject({ lostReason: "Price too high" });
    expect(lost.body?.data.closedAt).not.toBeNull();
  });

  it("reopening clears the closed time and reason (P3-STAGE-03)", async () => {
    const lead = await start();
    await moveStage(lead.id, { stageCode: "LOST", lostReason: "Price too high" });
    const open = await moveStage(lead.id, { stageCode: "CONTACTED" });
    expect(open.body?.data).toMatchObject({ closedAt: null, lostReason: null });
  });

  it("reopening is refused if the contact already has another open lead", async () => {
    const lead = await start();
    await moveStage(lead.id, { stageCode: "WON" });
    await post(input({ phone: lead.contact.phoneE164 }));
    expect((await moveStage(lead.id, { stageCode: "NEW" })).status).toBe(409);
  });

  it("refuses an unknown or inactive stage, but old leads keep showing it (P3-STAGE-04)", async () => {
    const lead = await start();
    expect((await moveStage(lead.id, { stageCode: "NOPE" })).status).toBe(400);
    await moveStage(lead.id, { stageCode: "QUOTED" });
    await prisma.leadsPipelineStage.update({
      where: { code: "QUOTED" },
      data: { isActive: false },
    });
    expect((await get(lead.id)).body?.data.stage.code).toBe("QUOTED");
    const other = (await post(input())).body!.data;
    expect((await moveStage(other.id, { stageCode: "QUOTED" })).status).toBe(400);
  });

  it("allows skipping stages (P3-STAGE-07), and the same stage does nothing (P3-STAGE-08)", async () => {
    const lead = await start();
    expect((await moveStage(lead.id, { stageCode: "QUOTED" })).status).toBe(200);
    const before = await prisma.auditEvent.count();
    expect((await moveStage(lead.id, { stageCode: "QUOTED" })).status).toBe(200);
    expect(await prisma.auditEvent.count()).toBe(before);
  });
});

describe("notes", () => {
  it("cannot be empty, and show their author after deactivation (P3-NOTE-01, P3-TL-03)", async () => {
    const author = await as("ADMIN");
    const lead = (await post(input())).body!.data;
    expect((await addNote(lead.id, { body: "   " })).status).toBe(400);
    expect((await addNote(lead.id, { body: "दो बच्चे <b>x</b>" })).status).toBe(201);
    await prisma.identityUser.update({ where: { id: author }, data: { status: "DEACTIVATED" } });
    await as("ADMIN");
    const detail = await get(lead.id);
    expect(detail.body?.data.notes[0]).toMatchObject({
      body: "दो बच्चे <b>x</b>",
      author: { id: author },
    });
    expect(
      detail.body?.data.timeline.some(
        (row: { actor: { id: string } | null }) => row.actor?.id === author,
      ),
    ).toBe(true);
  });

  it("have no edit or delete route (P3-NOTE-02)", () => {
    expect(Object.keys(noteRoute).sort()).toEqual(["POST"]);
  });
});

describe("follow-ups", () => {
  const tomorrow = "2099-01-02";

  it("need a title, a date and an active assignee in scope (P3-NOTE-03)", async () => {
    const manager = await as("MANAGER");
    const lead = (await post(input())).body!.data;
    const outside = await makeUser();
    const gone = await makeUser("AGENT", manager, "DEACTIVATED");
    expect((await addTask(lead.id, { title: " ", dueDate: tomorrow })).status).toBe(400);
    expect((await addTask(lead.id, { title: "Call" })).status).toBe(400);
    expect(
      (await addTask(lead.id, { title: "Call", dueDate: tomorrow, assigneeUserId: outside.id }))
        .status,
    ).toBe(400);
    expect(
      (await addTask(lead.id, { title: "Call", dueDate: tomorrow, assigneeUserId: gone.id }))
        .status,
    ).toBe(400);
    const ok = await addTask(lead.id, { title: "Call", dueDate: tomorrow });
    expect(ok.status).toBe(201);
    expect(ok.body?.data.assignee.id).toBe(manager);
  });

  it("refuses a past date; today is fine (P3-NOTE-08)", async () => {
    await as("ADMIN");
    const lead = (await post(input())).body!.data;
    const clock = createTestClock("2026-10-30T10:00:00.000Z");
    const tasks = createTaskService({ clock });
    const context = { principal: await testPrincipal("ADMIN", (await makeUser("ADMIN")).id) };
    await expect(
      tasks.addTask(context, lead.id, { title: "x", dueDate: "2026-10-29" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      tasks.addTask(context, lead.id, { title: "x", dueDate: "2026-10-30" }),
    ).resolves.toBeTruthy();
  });

  it("completing twice does nothing more; reopening works (P3-NOTE-06)", async () => {
    await as("ADMIN");
    const lead = (await post(input())).body!.data;
    const task = (await addTask(lead.id, { title: "Call", dueDate: tomorrow })).body!.data;
    const done = await setTask(lead.id, task.id, true);
    expect(done.body?.data.completedAt).not.toBeNull();
    const again = await setTask(lead.id, task.id, true);
    expect(again.body?.data.completedAt).toBe(done.body?.data.completedAt);
    expect(
      await prisma.leadsTimelineEntry.count({ where: { kind: "TASK", leadId: lead.id } }),
    ).toBe(2);
    expect((await setTask(lead.id, task.id, false)).body?.data.completedAt).toBeNull();
  });

  it("drive the lead's next follow-up, and closing clears it (P3-NOTE-09)", async () => {
    await as("ADMIN");
    const lead = (await post(input())).body!.data;
    const later = (await addTask(lead.id, { title: "Later", dueDate: "2099-03-01" })).body!.data;
    const sooner = (await addTask(lead.id, { title: "Sooner", dueDate: "2099-02-01" })).body!.data;
    expect((await get(lead.id)).body?.data.nextFollowUpDate).toBe("2099-02-01");
    await setTask(lead.id, sooner.id, true);
    expect((await get(lead.id)).body?.data.nextFollowUpDate).toBe("2099-03-01");
    await moveStage(lead.id, { stageCode: "WON" });
    expect((await get(lead.id)).body?.data.nextFollowUpDate).toBeNull();
    const page = await callRoute<Body<{ items: unknown[] }>>(followUps.GET, { path: "/x" });
    expect(page.body?.data.items).toEqual([]); // a closed lead stops reminding
    await moveStage(lead.id, { stageCode: "NEW" });
    expect((await get(lead.id)).body?.data.nextFollowUpDate).toBe("2099-03-01");
    expect(later.id).toBeTruthy();
  });

  it("overdue changes at business midnight, not UTC midnight (P3-NOTE-04, -05)", async () => {
    const me = await as("ADMIN");
    const lead = (await post(input())).body!.data;
    await prisma.leadsTask.create({
      data: {
        leadId: lead.id,
        assigneeUserId: me,
        title: "x",
        dueDate: businessDateToDbDate("2026-10-30"),
      },
    });
    const principal = await testPrincipal("ADMIN", me);
    const bucketAt = async (instant: string) => {
      const service = createTaskService({ clock: createTestClock(instant) });
      const { counts } = await service.listFollowUps({ principal }, { bucket: "open" });
      return counts;
    };
    // 23:59 in India on the due date: still today.
    expect(await bucketAt("2026-10-30T18:29:00.000Z")).toMatchObject({ today: 1, overdue: 0 });
    // 00:00 in India the next day, though still 30 Oct in UTC: overdue.
    expect(await bucketAt("2026-10-30T18:30:00.000Z")).toMatchObject({ today: 0, overdue: 1 });
    // Early on the due date in India, still the 29th in UTC: today.
    expect(await bucketAt("2026-10-29T18:30:00.000Z")).toMatchObject({ today: 1, overdue: 0 });
  });

  it("the page lists my tasks by bucket, on open leads I can reach", async () => {
    const me = await as("ADMIN");
    const lead = (await post(input())).body!.data;
    await addTask(lead.id, { title: "Mine", dueDate: tomorrow });
    const other = await makeUser();
    await addTask(lead.id, { title: "Theirs", dueDate: tomorrow, assigneeUserId: other.id });
    const page = await callRoute<
      Body<{ items: Array<{ title: string; assignee: { id: string } }> }>
    >(followUps.GET, { path: "/x?bucket=upcoming" });
    expect(page.body?.data.items.map((task) => task.title)).toEqual(["Mine"]);
    expect(page.body?.data.items[0].assignee.id).toBe(me);
  });
});

describe("the timeline", () => {
  it("records a source event once, even if delivered twice (P3-TL-01)", async () => {
    await as("ADMIN");
    const lead = (await post(input())).body!.data;
    const service = createLeadService();
    const event = {
      leadId: lead.id,
      kind: "MESSAGE" as const,
      summary: "Message",
      refType: "message",
      refId: "abc",
      occurredAt: parseInstant("2026-10-01T00:00:00.000Z"),
    };
    await service.recordTimelineEvent(event);
    await service.recordTimelineEvent(event);
    expect(await prisma.leadsTimelineEntry.count({ where: { refId: "abc" } })).toBe(1);
  });

  it("shows events in true time order, whatever order they arrived (P3-TL-02)", async () => {
    await as("ADMIN");
    const lead = (await post(input())).body!.data;
    const service = createLeadService();
    for (const [refId, at] of [
      ["late", "2099-01-03T00:00:00.000Z"],
      ["early", "2099-01-01T00:00:00.000Z"],
      ["mid", "2099-01-02T00:00:00.000Z"],
    ]) {
      await service.recordTimelineEvent({
        leadId: lead.id,
        kind: "CALL",
        summary: refId,
        refType: "call",
        refId,
        occurredAt: parseInstant(at),
      });
    }
    const rows = (await get(lead.id)).body!.data.timeline as Array<{
      summary: string;
      actor: unknown;
    }>;
    expect(rows.slice(0, 3).map((row) => row.summary)).toEqual(["late", "mid", "early"]);
    expect(rows[0].actor).toBeNull(); // P3-TL-03: no author still reads sensibly
  });
});
