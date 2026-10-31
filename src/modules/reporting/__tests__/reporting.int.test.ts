// Phase 9: every figure here was counted by hand from the small data set each test builds.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import {
  businessDateToDbDate,
  createTestClock,
  parseBusinessLocalDateTime as at,
} from "@/shared/time";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { createReportingService } from "../reporting.service";

const prisma = getPrisma();
const service = () =>
  createReportingService({ clock: createTestClock(at("2026-11-06", "15:00").toISOString()) });
const MONTH = { from: "2026-11-01", to: "2026-11-30" };
let counter = 0;

async function makeUser(
  roleCode = "AGENT",
  managerId?: string,
  status: "ACTIVE" | "DEACTIVATED" = "ACTIVE",
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: `${roleCode} ${++counter}`,
      passwordHash: "h",
      status,
      roleId: role.id,
      managerId,
    },
  });
}
const ctx = async (id: string, role = "AGENT") => ({ principal: await testPrincipal(role, id) });
async function makeLead(
  fields: {
    owner?: string;
    stage?: string;
    createdAt?: Date;
    reply?: Date;
    deleted?: boolean;
    budget?: number;
    source?: "WHATSAPP" | "AD";
    destination?: string;
    name?: string;
  } = {},
) {
  const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({
    where: { code: fields.stage ?? "NEW" },
  });
  const contact = await prisma.leadsContact.create({
    data: { phoneE164: `+9198${String(80000000 + ++counter)}`, name: fields.name ?? "Asha" },
  });
  return prisma.leadsLead.create({
    data: {
      contactId: contact.id,
      stageId: stage.id,
      ownerUserId: fields.owner,
      createdAt: fields.createdAt ?? at("2026-11-02", "12:00"),
      firstResponseAt: fields.reply,
      deletedAt: fields.deleted ? at("2026-11-03", "12:00") : null,
      budgetAmount: fields.budget,
      source: fields.source ?? "WHATSAPP",
      destination: fields.destination,
    },
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
const text = async (response: Response) => new TextDecoder().decode(await response.arrayBuffer());

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
});
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("numbers", () => {
  it("match a hand-counted set, and totals equal their parts (P9-REPORT-02, -12)", async () => {
    const admin = await makeUser("ADMIN");
    const [a, b] = [await makeUser(), await makeUser()];
    await makeLead({ owner: a.id, stage: "WON", budget: 1000, reply: at("2026-11-02", "12:04") });
    await makeLead({
      owner: a.id,
      stage: "WON",
      budget: 2500,
      reply: at("2026-11-02", "12:06"),
      source: "AD",
    });
    await makeLead({
      owner: a.id,
      stage: "QUOTED",
      reply: at("2026-11-02", "12:20"),
      destination: "Goa",
    });
    await makeLead({ owner: b.id, stage: "LOST", destination: "Goa" });
    await makeLead({ stage: "NEW", destination: "Ladakh" });
    const report = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);

    expect(report.totals).toEqual({
      leads: 5,
      won: 2,
      lost: 1,
      value: "3500.00",
      conversionPercent: 40,
    });
    expect(report.stages.map((s) => [s.code, s.count])).toEqual([
      ["NEW", 1],
      ["QUOTED", 1],
      ["WON", 2],
      ["LOST", 1],
    ]);
    expect(report.stages.reduce((sum, s) => sum + s.count, 0)).toBe(5);
    expect(report.perDay.reduce((sum, d) => sum + d.count, 0)).toBe(5);
    expect(report.sources).toEqual([
      { source: "WHATSAPP", count: 4 },
      { source: "AD", count: 1 },
    ]);
    expect(report.destinations).toEqual([
      { destination: "Goa", count: 2 },
      { destination: "Not set", count: 2 },
      { destination: "Ladakh", count: 1 },
    ]);
    // Replies at 4, 6 and 20 minutes: median 6, two of three within the 15-minute target.
    expect(report.response).toMatchObject({
      median: 6,
      responded: 3,
      noResponse: 2,
      targetMinutes: 15,
      withinTargetPercent: 66.7,
    });
    expect(report.response.bands.map((band) => band.count)).toEqual([1, 1, 0, 1, 0, 0]);
    const rowA = report.agents.find((row) => row.userId === a.id);
    expect(rowA).toMatchObject({
      leads: 3,
      won: 2,
      quoted: 1,
      firstReplyMedian: 6,
      conversionPercent: 66.7,
      value: "3500",
    });
    expect(report.agents.reduce((sum, row) => sum + row.leads, 0)).toBe(4); // the fifth has no owner
  });

  it("buckets on the business day, across a year end (P9-REPORT-03)", async () => {
    const admin = await makeUser("ADMIN");
    await makeLead({ createdAt: at("2026-12-31", "23:59") });
    await makeLead({ createdAt: at("2027-01-01", "00:01") });
    const { perDay } = await service().getReport(await ctx(admin.id, "ADMIN"), {
      from: "2026-12-31",
      to: "2027-01-01",
    });
    expect(perDay).toEqual([
      { day: "2026-12-31", count: 1 },
      { day: "2027-01-01", count: 1 },
    ]);
  });

  it("includes both end days, and refuses them reversed (P9-REPORT-04)", async () => {
    const admin = await makeUser("ADMIN");
    const context = await ctx(admin.id, "ADMIN");
    await makeLead({ createdAt: at("2026-11-02", "00:00") });
    await makeLead({ createdAt: at("2026-11-03", "23:59") });
    await makeLead({ createdAt: at("2026-11-04", "00:00") });
    expect(
      (await service().getReport(context, { from: "2026-11-02", to: "2026-11-03" })).totals.leads,
    ).toBe(2);
    expect(
      (await failure(service().getReport(context, { from: "2026-11-05", to: "2026-11-01" }))).code,
    ).toBe("VALIDATION_FAILED");
    expect(
      (await failure(service().getReport(context, { from: "2024-01-01", to: "2026-01-01" }))).code,
    ).toBe("VALIDATION_FAILED");
  });

  it("shows zeros with no data, not errors (P9-REPORT-05)", async () => {
    const admin = await makeUser("ADMIN");
    const report = await service().getReport(await ctx(admin.id, "ADMIN"), {
      from: "2026-11-01",
      to: "2026-11-03",
    });
    expect(report.totals).toEqual({
      leads: 0,
      won: 0,
      lost: 0,
      value: "0.00",
      conversionPercent: 0,
    });
    expect(report.response.median).toBeNull();
    expect(report.perDay).toHaveLength(3);
    expect(report.agents).toEqual([]);
  });

  it("leaves out deleted and merged leads everywhere (P9-REPORT-06, -09)", async () => {
    const admin = await makeUser("ADMIN");
    const a = await makeUser();
    await makeLead({ owner: a.id, deleted: true, stage: "WON" });
    await makeLead({ owner: a.id });
    const report = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);
    expect(report.totals.leads).toBe(1);
    expect(report.totals.won).toBe(0);
    expect(report.agents[0].leads).toBe(1);
  });

  it("keeps a deactivated agent in the history (P9-REPORT-07)", async () => {
    const admin = await makeUser("ADMIN");
    const gone = await makeUser("AGENT", undefined, "DEACTIVATED");
    await makeLead({ owner: gone.id });
    const { agents } = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);
    expect(agents[0]).toMatchObject({ userId: gone.id, deactivated: true });
  });

  it("counts a reassigned lead once, under its current owner (P9-REPORT-08)", async () => {
    const admin = await makeUser("ADMIN");
    const [before, after] = [await makeUser(), await makeUser()];
    const lead = await makeLead({ owner: before.id });
    await prisma.leadsLead.update({ where: { id: lead.id }, data: { ownerUserId: after.id } });
    const { agents } = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);
    expect(agents.map((row) => row.userId)).toEqual([after.id]);
  });

  it("counts a reopened lead once (P9-REPORT-09)", async () => {
    const admin = await makeUser("ADMIN");
    const lead = await makeLead({ stage: "LOST" });
    const open = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
    await prisma.leadsLead.update({ where: { id: lead.id }, data: { stageId: open.id } });
    const report = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);
    expect(report.totals).toMatchObject({ leads: 1, lost: 0 });
  });

  it("measures replies in working time, and reports those without one (P9-REPORT-10)", async () => {
    const admin = await makeUser("ADMIN");
    await makeLead({ createdAt: at("2026-11-02", "22:00"), reply: at("2026-11-03", "10:05") });
    await makeLead({ createdAt: at("2026-11-02", "12:00") });
    const { response } = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);
    expect(response.median).toBe(5);
    expect(response).toMatchObject({ noResponse: 1, missed: 1 });
  });

  it("counts as missed a late reply or an open lead past its deadline, not a closed one", async () => {
    const admin = await makeUser("ADMIN");
    await makeLead({ reply: at("2026-11-02", "12:20") }); // late
    await makeLead({ reply: at("2026-11-02", "12:05") }); // on time
    await makeLead(); // still open, past its deadline
    await makeLead({ stage: "LOST" }); // closed with no reply
    const { response } = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);
    expect(response).toMatchObject({ responded: 2, noResponse: 2, missed: 2 });
  });

  it("counts assignments by mode, leaving out a leaver's note (Decision 65)", async () => {
    const admin = await makeUser("ADMIN");
    const a = await makeUser();
    const lead = await makeLead({ owner: a.id });
    const record = (mode: "MANUAL" | "BLAST", fromUserId?: string) =>
      prisma.assignmentRecord.create({
        data: {
          leadId: lead.id,
          toUserId: a.id,
          fromUserId,
          mode,
          createdAt: at("2026-11-02", "13:00"),
        },
      });
    await record("BLAST");
    await record("MANUAL");
    await record("MANUAL", a.id); // the owner left
    const { modes } = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);
    expect(modes).toEqual([
      { mode: "BLAST", count: 1 },
      { mode: "MANUAL", count: 1 },
    ]);
  });

  it("keeps the funnel right when stages are renamed, moved or switched off (P9-REPORT-11)", async () => {
    const admin = await makeUser("ADMIN");
    await makeLead({ stage: "QUOTED" });
    await makeLead({ stage: "QUALIFIED" });
    await prisma.leadsPipelineStage.update({
      where: { code: "QUOTED" },
      data: { name: "Offer", position: 1, isActive: false },
    });
    const { stages } = await service().getReport(await ctx(admin.id, "ADMIN"), MONTH);
    expect(stages.map((s) => [s.name, s.count])).toEqual([
      ["Offer", 1],
      ["Qualified", 1],
    ]);
  });

  it("combines filters, and they only narrow (P9-REPORT-12)", async () => {
    const admin = await makeUser("ADMIN");
    const [a, b] = [await makeUser(), await makeUser()];
    await makeLead({ owner: a.id, source: "AD" });
    await makeLead({ owner: a.id });
    await makeLead({ owner: b.id, source: "AD" });
    const context = await ctx(admin.id, "ADMIN");
    expect((await service().getReport(context, { ...MONTH, source: "AD" })).totals.leads).toBe(2);
    expect((await service().getReport(context, { ...MONTH, agentId: a.id })).totals.leads).toBe(2);
    expect(
      (await service().getReport(context, { ...MONTH, agentId: a.id, source: "AD" })).totals.leads,
    ).toBe(1);
    const team = await prisma.identityTeam.create({
      data: { name: "North", members: { create: { userId: b.id } } },
    });
    expect((await service().getReport(context, { ...MONTH, teamId: team.id })).totals.leads).toBe(
      1,
    );
  });

  it("stays quick on 100,000 leads (P9-REPORT-13)", async () => {
    const admin = await makeUser("ADMIN");
    const owner = await makeUser();
    const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
    await prisma.$executeRaw`INSERT INTO leads_contacts (id, "phoneE164", "updatedAt")
      SELECT gen_random_uuid(), '+9197' || lpad(i::text, 8, '0'), now() FROM generate_series(1, 100000) i`;
    await prisma.$executeRaw`INSERT INTO leads_leads (id, "contactId", "stageId", "ownerUserId", "createdAt", "firstResponseAt", "updatedAt")
      SELECT gen_random_uuid(), c.id, ${stage.id}::uuid, ${owner.id}::uuid,
        t, t + (random() * interval '2 hours'), now()
      FROM leads_contacts c
      CROSS JOIN LATERAL (
        SELECT ${at("2026-06-01", "12:00")}::timestamptz + (random() * interval '150 days') + (c.id::text < '') ::int * interval '0' AS t
      ) picked`;
    const started = performance.now();
    const report = await service().getReport(await ctx(admin.id, "ADMIN"), {
      from: "2026-06-01",
      to: "2026-11-30",
    });
    expect(report.totals.leads).toBe(100000);
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 120_000);
});

describe("scope (P9-REPORT-01)", () => {
  it("gives a manager their branch only, even when asking for someone else", async () => {
    const manager = await makeUser("MANAGER");
    const mine = await makeUser("AGENT", manager.id);
    const other = await makeUser();
    await makeLead({ owner: mine.id });
    await makeLead({ owner: other.id });
    await makeLead();
    const context = await ctx(manager.id, "MANAGER");
    expect((await service().getReport(context, MONTH)).totals.leads).toBe(1);
    expect((await service().getReport(context, { ...MONTH, agentId: other.id })).totals.leads).toBe(
      0,
    );
  });

  it("refuses reports to an agent", async () => {
    const agent = await makeUser();
    expect((await failure(service().getReport(await ctx(agent.id), MONTH))).code).toBe("FORBIDDEN");
  });

  it("gives the dashboard by permission", async () => {
    const manager = await makeUser("MANAGER");
    const agent = await makeUser("AGENT", manager.id);
    const other = await makeUser();
    await makeLead({ owner: agent.id, createdAt: at("2026-11-06", "10:00") });
    await makeLead({ owner: other.id, createdAt: at("2026-11-06", "10:00") });
    await makeLead({ createdAt: at("2026-11-06", "10:00") });
    const admin = await makeUser("ADMIN");

    const own = await service().getDashboard(await ctx(agent.id), { range: "today" });
    expect(own).toMatchObject({ scope: "own", leads: 1, open: 1, queue: null, agents: [] });
    const team = await service().getDashboard(await ctx(manager.id, "MANAGER"), { range: "today" });
    expect(team).toMatchObject({ scope: "team", leads: 1, open: 1, queue: 1 });
    expect(team.agents.map((row) => row.userId)).toEqual([agent.id]);
    const all = await service().getDashboard(await ctx(admin.id, "ADMIN"), { range: "today" });
    expect(all).toMatchObject({ scope: "all", leads: 3, open: 3, queue: 1 });
  });

  it("shows an agent their follow-ups and calls", async () => {
    const agent = await makeUser();
    const lead = await makeLead({ owner: agent.id, createdAt: at("2026-11-06", "10:00") });
    for (const [title, day] of [
      ["Late", "2026-11-05"],
      ["Now", "2026-11-06"],
      ["Later", "2026-11-09"],
    ]) {
      await prisma.leadsTask.create({
        data: {
          leadId: lead.id,
          assigneeUserId: agent.id,
          title,
          dueDate: businessDateToDbDate(day),
        },
      });
    }
    await prisma.telephonyCall.create({
      data: {
        providerKey: "fake",
        callRef: randomUUID(),
        agentUserId: agent.id,
        leadId: lead.id,
        customerPhoneE164: "+919800000000",
        status: "COMPLETED",
        startedAt: at("2026-11-06", "11:00"),
        durationSeconds: 90,
      },
    });
    const dash = await service().getDashboard(await ctx(agent.id), { range: "today" });
    expect(dash).toMatchObject({ overdue: 1, dueToday: 1, calls: 1, talkSeconds: 90 });
    expect(dash.upNext.map((task) => [task.title, task.overdue])).toEqual([
      ["Late", true],
      ["Now", false],
      ["Later", false],
    ]);
    expect(dash.callsPerDay.at(-1)).toEqual({ day: "2026-11-06", count: 1 });
  });
});

describe("exports", () => {
  it("need their own permission, and are audited (P9-EXPORT-01, -02)", async () => {
    const role = await prisma.identityRole.create({
      data: { code: "VIEWER_ONLY", name: "V", description: "", isSystem: false },
    });
    const codes = await prisma.identityPermission.findMany({
      where: { code: { in: ["reports:view"] } },
    });
    await prisma.identityRolePermission.createMany({
      data: codes.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    const viewer = await makeUser("VIEWER_ONLY");
    const refused = await failure(
      service().exportCsv(await ctx(viewer.id, "VIEWER_ONLY"), { ...MONTH, kind: "agents" }),
    );
    expect(refused.code).toBe("FORBIDDEN");

    const admin = await makeUser("ADMIN");
    await service().exportCsv(await ctx(admin.id, "ADMIN"), { ...MONTH, kind: "agents" });
    expect(await prisma.auditEvent.count({ where: { action: "reports.exported" } })).toBe(1);
  });

  it("match the screen, and stay in scope (P9-EXPORT-01)", async () => {
    const manager = await makeUser("MANAGER");
    const mine = await makeUser("AGENT", manager.id);
    const other = await makeUser();
    await makeLead({ owner: mine.id, name: "Mine" });
    await makeLead({ owner: other.id, name: "Theirs" });
    const context = await ctx(manager.id, "MANAGER");
    const csv = await text(await service().exportCsv(context, { ...MONTH, kind: "leads" }));
    expect(csv).toContain("Mine");
    expect(csv).not.toContain("Theirs");
    const agents = await text(await service().exportCsv(context, { ...MONTH, kind: "agents" }));
    expect(agents).toContain(mine.name);
    expect(agents).not.toContain(other.name);
  });

  it("carry no secrets (P9-EXPORT-03), safe text (P9-EXPORT-04, -05), business dates (P9-EXPORT-07)", async () => {
    const admin = await makeUser("ADMIN");
    await makeLead({ name: "=HYPERLINK(1)", createdAt: at("2026-11-02", "00:30") });
    await makeLead({ name: "सुनीता 🌴" });
    const response = await service().exportCsv(await ctx(admin.id, "ADMIN"), {
      ...MONTH,
      kind: "leads",
    });
    expect(response.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("सुनीता 🌴");
    expect(csv).toContain("2 Nov 2026, 12:30 am");
    expect(csv).not.toMatch(/passwordHash|providerRecordingRef|storageKey/);
  });

  it("run in batches past the batch size, without repeats (P9-EXPORT-06)", async () => {
    const admin = await makeUser("ADMIN");
    const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
    await prisma.$executeRaw`INSERT INTO leads_contacts (id, "phoneE164", "updatedAt")
      SELECT gen_random_uuid(), '+9196' || lpad(i::text, 8, '0'), now() FROM generate_series(1, 2500) i`;
    await prisma.$executeRaw`INSERT INTO leads_leads (id, "contactId", "stageId", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), c.id, ${stage.id}::uuid, ${at("2026-11-02", "12:00")}::timestamptz, now() FROM leads_contacts c`;
    const csv = await text(
      await service().exportCsv(await ctx(admin.id, "ADMIN"), { ...MONTH, kind: "leads" }),
    );
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2501);
    expect(new Set(lines).size).toBe(2501);
  }, 60_000);

  it.each(["volume", "assignment", "response", "funnel", "agents", "leads"] as const)(
    "%s is still valid when empty (P9-EXPORT-08)",
    async (kind) => {
      const admin = await makeUser("ADMIN");
      const csv = await text(
        await service().exportCsv(await ctx(admin.id, "ADMIN"), {
          from: "2026-11-01",
          to: "2026-11-01",
          kind,
        }),
      );
      expect(csv.split("\r\n")[0].length).toBeGreaterThan(1);
    },
  );
});
