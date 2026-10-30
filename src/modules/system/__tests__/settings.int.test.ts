// Phase 3: system settings and pipeline stage configuration.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as settingsRoute from "@/app/api/settings/route";
import * as stageItem from "@/app/api/settings/stages/[id]/route";
import * as stagesRoute from "@/app/api/settings/stages/route";
import * as leadsRoute from "@/app/api/leads/route";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { getPrisma } from "@/shared/db/prisma";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { ensureDefaultSettings, getSetting } from "..";

const prisma = getPrisma();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body<T = any> = {
  data: T;
  error: { code: string; fieldErrors?: Array<{ field: string; message: string }> };
};

const as = async (roleCode: string) => {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  const user = await prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Tara",
      passwordHash: "h",
      status: "ACTIVE",
      roleId: role.id,
    },
  });
  actAs(await testPrincipal(roleCode, user.id));
  return user.id;
};
const setOne = (key: string, value: unknown) =>
  callRoute<Body>(settingsRoute.PATCH, { method: "PATCH", path: "/x", body: { key, value } });

beforeEach(async () => {
  stopActing();
  await resetDatabase();
  await syncRbac();
  await ensureDefaultSettings();
  await ensureDefaultStages();
});
afterEach(() => stopActing());
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("settings", () => {
  it("defaults exist, and seeding again keeps edited values (P3-SET-01)", async () => {
    await as("ADMIN");
    expect(await getSetting("assignment.timeoutMinutes")).toBe(30);
    await setOne("assignment.timeoutMinutes", 45);
    await ensureDefaultSettings();
    expect(await getSetting("assignment.timeoutMinutes")).toBe(45);
    expect(await prisma.systemSetting.count()).toBeGreaterThanOrEqual(11);
  });

  it("refuses a wrong type, an out-of-range value or an unknown key (P3-SET-02)", async () => {
    await as("ADMIN");
    for (const value of [-1, 0, "soon", 1.5, null, 100000]) {
      expect((await setOne("assignment.timeoutMinutes", value)).status, String(value)).toBe(400);
    }
    expect((await setOne("telephony.inboundFallback", "maybe")).status).toBe(400);
    expect((await setOne("made.up", 1)).status).toBe(400);
  });

  it("audits old and new values, and a repeat writes nothing (P3-SET-04)", async () => {
    const me = await as("ADMIN");
    await setOne("sla.firstResponseMinutes", 20);
    await setOne("sla.firstResponseMinutes", 20);
    const events = await prisma.auditEvent.findMany({ where: { action: "setting.updated" } });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({ from: 15, to: 20 });
    expect(events[0].actorUserId).toBe(me);
  });

  it("only those with the permission can read or change them", async () => {
    await as("MANAGER");
    expect((await callRoute(settingsRoute.GET, { path: "/x" })).status).toBe(403);
    expect((await setOne("sla.firstResponseMinutes", 20)).status).toBe(403);
  });
});

describe("pipeline stages", () => {
  const stageId = async (code: string) =>
    (await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code } })).id;
  const patchStage = (id: string, body: unknown) =>
    callRoute<Body, { id: string }>(stageItem.PATCH, {
      method: "PATCH",
      path: "/x",
      params: { id },
      body,
    });
  const deleteStage = (id: string) =>
    callRoute<Body, { id: string }>(stageItem.DELETE, {
      method: "DELETE",
      path: "/x",
      params: { id },
    });

  it("seeds the travel default, once", async () => {
    await ensureDefaultStages();
    const rows = await prisma.leadsPipelineStage.findMany({ orderBy: { position: "asc" } });
    expect(rows.map((row) => row.code)).toEqual([
      "NEW",
      "CONTACTED",
      "QUALIFIED",
      "QUOTED",
      "WON",
      "LOST",
    ]);
  });

  it("a stage in use cannot be deleted; an unused one can (P3-STAGE-05)", async () => {
    await as("ADMIN");
    await callRoute(leadsRoute.POST, {
      method: "POST",
      path: "/x",
      body: { customerName: "Riya", phone: "9000000001", source: "MANUAL" },
    });
    expect((await deleteStage(await stageId("NEW"))).status).toBe(409);
    await prisma.leadsLead.updateMany({ data: { stageId: await stageId("QUOTED") } });
    const refused = await deleteStage(await stageId("QUOTED"));
    expect(refused.status).toBe(409);
    expect(refused.body?.error.fieldErrors?.[0].message).toMatch(/Switch it off/);
    const added = await callRoute<Body>(stagesRoute.POST, {
      method: "POST",
      path: "/x",
      body: { name: "On hold", position: 35 },
    });
    expect(added.status).toBe(201);
    expect(added.body?.data.code).toBe("ON_HOLD");
    expect((await deleteStage(added.body!.data.id)).status).toBe(200);
  });

  it("reordering changes display, not lead history (P3-STAGE-06)", async () => {
    await as("ADMIN");
    const lead = await callRoute<Body>(leadsRoute.POST, {
      method: "POST",
      path: "/x",
      body: { customerName: "Riya", phone: "9000000002", source: "MANUAL" },
    });
    const before = await prisma.leadsTimelineEntry.findMany({
      where: { leadId: lead.body!.data.id },
    });
    expect((await patchStage(await stageId("QUOTED"), { position: 15 })).status).toBe(200);
    const list = await callRoute<Body>(stagesRoute.GET, { path: "/x" });
    expect(list.body?.data.map((row: { code: string }) => row.code).slice(0, 3)).toEqual([
      "NEW",
      "QUOTED",
      "CONTACTED",
    ]);
    expect(
      await prisma.leadsTimelineEntry.findMany({ where: { leadId: lead.body!.data.id } }),
    ).toEqual(before);
  });

  it("the last active stage of a kind stays, and a stage can be switched off", async () => {
    await as("ADMIN");
    expect((await patchStage(await stageId("QUALIFIED"), { isActive: false })).status).toBe(200);
    expect((await patchStage(await stageId("WON"), { isActive: false })).status).toBe(409);
    expect((await patchStage(await stageId("NEW"), { isActive: false })).status).toBe(409);
  });

  it("names are unique in any case", async () => {
    await as("ADMIN");
    const result = await callRoute(stagesRoute.POST, {
      method: "POST",
      path: "/x",
      body: { name: "contacted", position: 1 },
    });
    expect(result.status).toBe(409);
  });
});
