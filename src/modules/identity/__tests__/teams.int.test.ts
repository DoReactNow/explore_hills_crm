// Phase 2: reporting lines, teams and who can see whom, through the real API.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as deactivate from "@/app/api/users/[id]/deactivate/route";
import * as userItem from "@/app/api/users/[id]/route";
import * as users from "@/app/api/users/route";
import * as member from "@/app/api/teams/[id]/members/[userId]/route";
import * as members from "@/app/api/teams/[id]/members/route";
import * as teamItem from "@/app/api/teams/[id]/route";
import * as teams from "@/app/api/teams/route";
import { getPrisma } from "@/shared/db/prisma";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { getVisibleAgentIds, syncRbac } from "..";

const prisma = getPrisma();
type Body<T = Record<string, unknown>> = {
  data: T;
  error: { code: string; fieldErrors?: Array<{ field: string; message: string }> };
};
type Id = { id: string };

async function makeUser(
  roleCode = "AGENT",
  overrides: { managerId?: string; status?: "ACTIVE" | "DEACTIVATED"; name?: string } = {},
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: overrides.name ?? "Tara Singh",
      passwordHash: "hash",
      status: overrides.status ?? "ACTIVE",
      roleId: role.id,
      managerId: overrides.managerId,
    },
  });
}
const as = async (roleCode: string, userId?: string) => {
  const id = userId ?? (await makeUser(roleCode)).id;
  actAs(await testPrincipal(roleCode, id));
  return id;
};
const patchUser = (id: string, body: unknown) =>
  callRoute<Body, Id>(userItem.PATCH, { method: "PATCH", path: "/x", params: { id }, body });
const getUser = (id: string) => callRoute<Body, Id>(userItem.GET, { path: "/x", params: { id } });
const listUsers = (query = "") =>
  callRoute<
    Body<{
      items: Array<{ id: string; name: string }>;
      total: number;
      statusCounts: Record<string, number>;
    }>
  >(users.GET, { path: `/api/users${query}` });
const postTeam = (body: unknown) =>
  callRoute<Body<{ id: string }>>(teams.POST, { method: "POST", path: "/api/teams", body });
const SCOPE = { own: "users:view", team: "users:view", all: "users:view-all" } as const;

beforeEach(async () => {
  stopActing();
  await resetDatabase();
  await syncRbac();
});
afterEach(() => stopActing());
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("reporting lines", () => {
  it("refuses being your own manager (P2-HIER-01)", async () => {
    const user = await makeUser();
    await as("ADMIN");
    const result = await patchUser(user.id, { managerId: user.id });
    expect(result.status).toBe(400);
    expect(result.body?.error.fieldErrors?.[0].field).toBe("managerId");
    await expect(
      prisma.identityUser.update({ where: { id: user.id }, data: { managerId: user.id } }),
    ).rejects.toThrow();
  });

  it("refuses a loop, short or long (P2-HIER-01)", async () => {
    const top = await makeUser("MANAGER");
    const middle = await makeUser("MANAGER", { managerId: top.id });
    const bottom = await makeUser("AGENT", { managerId: middle.id });
    await as("ADMIN");
    expect((await patchUser(top.id, { managerId: middle.id })).status).toBe(400);
    expect((await patchUser(top.id, { managerId: bottom.id })).status).toBe(400);
  });

  it("refuses a loop from two changes arriving together, every time (P2-HIER-01)", async () => {
    await as("ADMIN");
    for (let round = 0; round < 8; round += 1) {
      const first = await makeUser("MANAGER");
      const second = await makeUser("MANAGER");
      const results = await Promise.all([
        patchUser(first.id, { managerId: second.id }),
        patchUser(second.id, { managerId: first.id }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    }
  });

  it("refuses a deactivated, unknown or malformed manager", async () => {
    const user = await makeUser();
    const gone = await makeUser("MANAGER", { status: "DEACTIVATED" });
    await as("ADMIN");
    for (const managerId of [gone.id, randomUUID(), "not-a-uuid"]) {
      expect((await patchUser(user.id, { managerId })).status, managerId).toBe(400);
    }
  });

  it("audits a manager change", async () => {
    const manager = await makeUser("MANAGER");
    const user = await makeUser();
    await as("ADMIN");
    await patchUser(user.id, { managerId: manager.id });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "user.manager_changed" },
    });
    expect(event.entityId).toBe(user.id);
  });

  it("an Admin cannot change a Super Admin's manager or teams (P1-SUPER-01)", async () => {
    const top = await makeUser("SUPER_ADMIN");
    const manager = await makeUser("MANAGER");
    await as("ADMIN");
    expect((await patchUser(top.id, { managerId: manager.id })).status).toBe(403);
    expect((await patchUser(top.id, { teamIds: [] })).status).toBe(403);
  });
});

describe("who can see whom", () => {
  it("a manager sees the whole chain below, not sideways or up (P2-HIER-02, Q-03)", async () => {
    const senior = await makeUser("MANAGER");
    const middle = await makeUser("MANAGER", { managerId: senior.id });
    const agent = await makeUser("AGENT", { managerId: middle.id });
    const other = await makeUser("AGENT");

    await as("MANAGER", senior.id);
    const ids = (await listUsers()).body?.data.items.map((row) => row.id);
    expect(ids?.sort()).toEqual([senior.id, middle.id, agent.id].sort());
    expect((await getUser(agent.id)).status).toBe(200);
    expect((await getUser(other.id)).status).toBe(404); // X-ACCESS-05
    expect((await getUser(senior.id)).status).toBe(200);

    await as("MANAGER", middle.id);
    expect((await getUser(senior.id)).status).toBe(404);
  });

  it("a team's manager sees its members, and totals stay in scope (X-ACCESS-08)", async () => {
    const lead = await makeUser("MANAGER");
    const member1 = await makeUser();
    await makeUser();
    const team = await prisma.identityTeam.create({
      data: { name: "North", managerUserId: lead.id },
    });
    await prisma.identityTeamMember.create({ data: { teamId: team.id, userId: member1.id } });
    await as("MANAGER", lead.id);
    const result = await listUsers();
    expect(result.body?.data.total).toBe(2);
    expect(result.body?.data.statusCounts).toEqual({ ACTIVE: 2 });
  });

  it("moving an agent changes what both managers see on the next request (P2-HIER-03)", async () => {
    const first = await makeUser("MANAGER");
    const second = await makeUser("MANAGER");
    const agent = await makeUser("AGENT", { managerId: first.id });
    await as("ADMIN");
    await patchUser(agent.id, { managerId: second.id });
    await as("MANAGER", first.id);
    expect((await getUser(agent.id)).status).toBe(404);
    await as("MANAGER", second.id);
    expect((await getUser(agent.id)).status).toBe(200);
  });

  it("a person with no manager or team, or no reports, sees only themselves (P2-HIER-08, -09)", async () => {
    const alone = await testPrincipal("MANAGER", (await makeUser("MANAGER")).id);
    expect(await getVisibleAgentIds(alone, SCOPE)).toEqual([alone.userId]);
    const agent = await testPrincipal("AGENT", (await makeUser()).id);
    expect(await getVisibleAgentIds(agent, { own: "system:view-diagnostics" })).toEqual([]);
  });

  it("the Super Admin and an Admin see everyone", async () => {
    const top = await testPrincipal("SUPER_ADMIN", (await makeUser("SUPER_ADMIN")).id);
    const admin = await testPrincipal("ADMIN", (await makeUser("ADMIN")).id);
    expect(await getVisibleAgentIds(top, SCOPE)).toBe("all");
    expect(await getVisibleAgentIds(admin, SCOPE)).toBe("all");
  });

  it("a deactivated agent stays visible by name (P2-HIER-05)", async () => {
    const gone = await makeUser("AGENT", { status: "DEACTIVATED", name: "Former Agent" });
    await as("ADMIN");
    expect((await getUser(gone.id)).body?.data.name).toBe("Former Agent");
  });

  it("responses never carry the bypass flag", async () => {
    const top = await makeUser("SUPER_ADMIN");
    await as("ADMIN");
    const one = await getUser(top.id);
    expect(JSON.stringify(one.body)).not.toContain("bypassesAccess");
    expect(one.body?.data).toMatchObject({ canManage: false });
    expect(JSON.stringify((await listUsers()).body)).not.toContain("bypassesAccess");
    const agent = await makeUser();
    expect((await getUser(agent.id)).body?.data).toMatchObject({ canManage: true });
  });
});

describe("the user list", () => {
  it("filters and sorts on every column", async () => {
    const manager = await makeUser("MANAGER", { name: "Bela Manager" });
    await makeUser("AGENT", { name: "anil Kumar", managerId: manager.id });
    const zoya = await makeUser("AGENT", { name: "Zoya Khan", status: "DEACTIVATED" });
    const team = await prisma.identityTeam.create({ data: { name: "Alpha" } });
    await prisma.identityTeamMember.create({ data: { teamId: team.id, userId: zoya.id } });
    await as("ADMIN", (await makeUser("ADMIN", { name: "Mina Admin" })).id);

    const names = async (query: string) =>
      (await listUsers(query)).body?.data.items.map((row) => row.name);

    expect(await names("?sort=name")).toEqual([
      "anil Kumar",
      "Bela Manager",
      "Mina Admin",
      "Zoya Khan",
    ]);
    expect(await names("?sort=name&direction=desc")).toEqual([
      "Zoya Khan",
      "Mina Admin",
      "Bela Manager",
      "anil Kumar",
    ]);
    expect((await names("?sort=team"))?.[0]).toBe("Zoya Khan");
    expect((await names("?sort=manager"))?.[0]).toBe("anil Kumar");
    expect((await names("?sort=role"))?.[0]).toBe("Mina Admin");
    expect((await names("?sort=status&direction=desc"))?.[0]).toBe("Zoya Khan");
    expect(await names("?search=KHAN")).toEqual(["Zoya Khan"]);
    expect(await names("?search=%25")).toEqual([]); // a wildcard is plain text
    expect(await names("?status=DEACTIVATED")).toEqual(["Zoya Khan"]);
    expect(await names("?roleCode=MANAGER")).toEqual(["Bela Manager"]);
    expect(await names(`?teamId=${team.id}`)).toEqual(["Zoya Khan"]);
  });

  it("gives friendly errors for a bad sort, and page sizes stay limited", async () => {
    await as("ADMIN");
    expect((await listUsers("?sort=passwordHash")).status).toBe(400);
    expect((await listUsers("?pageSize=100000")).status).toBe(400);
  });
});

describe("teams", () => {
  it("names are unique in any case, also when two arrive together (P2-HIER-07)", async () => {
    await as("ADMIN");
    expect((await postTeam({ name: "Sales North" })).status).toBe(201);
    expect((await postTeam({ name: "SALES north" })).status).toBe(409);
    const both = await Promise.all([postTeam({ name: "South" }), postTeam({ name: "south" })]);
    expect(both.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it("a person can belong to several teams (Q-04)", async () => {
    const user = await makeUser();
    await as("ADMIN");
    const first = (await postTeam({ name: "One" })).body!.data.id;
    const second = (await postTeam({ name: "Two" })).body!.data.id;
    const result = await patchUser(user.id, { teamIds: [first, second] });
    expect(result.status).toBe(200);
    expect(result.body?.data.teamMemberships).toHaveLength(2);
    expect(await prisma.auditEvent.count({ where: { action: "user.teams_changed" } })).toBe(1);
    expect((await patchUser(user.id, { teamIds: [randomUUID()] })).status).toBe(400);
  });

  it("adds and removes members, repeating quietly, audited once each", async () => {
    const user = await makeUser();
    await as("ADMIN");
    const id = (await postTeam({ name: "One" })).body!.data.id;
    const add = () =>
      callRoute<Body, Id>(members.POST, {
        method: "POST",
        path: "/x",
        params: { id },
        body: { userId: user.id },
      });
    const remove = () =>
      callRoute<Body, { id: string; userId: string }>(member.DELETE, {
        method: "DELETE",
        path: "/x",
        params: { id, userId: user.id },
      });
    expect((await add()).status).toBe(200);
    await add();
    expect(await prisma.identityTeamMember.count()).toBe(1);
    expect((await remove()).status).toBe(200);
    await remove();
    expect(await prisma.auditEvent.count({ where: { action: "team.member_added" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "team.member_removed" } })).toBe(1);
  });

  it("an Admin cannot add a Super Admin to a team", async () => {
    const top = await makeUser("SUPER_ADMIN");
    await as("ADMIN");
    const id = (await postTeam({ name: "One" })).body!.data.id;
    const result = await callRoute(members.POST, {
      method: "POST",
      path: "/x",
      params: { id },
      body: { userId: top.id },
    });
    expect(result.status).toBe(403);
  });

  it("a team with members cannot be deleted; an empty one can (P2-HIER-06)", async () => {
    const user = await makeUser();
    await as("ADMIN");
    const id = (await postTeam({ name: "One" })).body!.data.id;
    await patchUser(user.id, { teamIds: [id] });
    const del = () =>
      callRoute<Body, Id>(teamItem.DELETE, { method: "DELETE", path: "/x", params: { id } });
    const refused = await del();
    expect(refused.status).toBe(409);
    expect(refused.body?.error.fieldErrors?.[0].message).toMatch(/Move this team's members/);
    await patchUser(user.id, { teamIds: [] });
    expect((await del()).status).toBe(200);
    expect(await prisma.identityTeam.count()).toBe(0);
  });

  it("a manager with active reports or a team cannot be deactivated until they move (P2-HIER-04, -06)", async () => {
    const manager = await makeUser("MANAGER");
    const agent = await makeUser("AGENT", { managerId: manager.id });
    await as("ADMIN");
    const off = () =>
      callRoute<Body, Id>(deactivate.POST, {
        method: "POST",
        path: "/x",
        params: { id: manager.id },
        body: { openLeads: "queue" },
      });

    const refused = await off();
    expect(refused.status).toBe(409);
    expect(refused.body?.error.fieldErrors?.[0].message).toMatch(/still manages/);

    await patchUser(agent.id, { managerId: null });
    const team = (await postTeam({ name: "One", managerUserId: manager.id })).body!.data.id;
    expect((await off()).status).toBe(409);

    await callRoute(teamItem.PATCH, {
      method: "PATCH",
      path: "/x",
      params: { id: team },
      body: { managerUserId: null },
    });
    expect((await off()).status).toBe(200);
  });

  it("a deactivated report does not hold their manager back", async () => {
    const manager = await makeUser("MANAGER");
    await makeUser("AGENT", { managerId: manager.id, status: "DEACTIVATED" });
    await as("ADMIN");
    const off = await callRoute(deactivate.POST, {
      method: "POST",
      path: "/x",
      params: { id: manager.id },
      body: { openLeads: "queue" },
    });
    expect(off.status).toBe(200);
  });

  it("a manager sees only teams in their branch, and an out-of-scope team is not found", async () => {
    const manager = await makeUser("MANAGER");
    const mine = await prisma.identityTeam.create({
      data: { name: "Mine", managerUserId: manager.id },
    });
    const other = await prisma.identityTeam.create({ data: { name: "Other" } });
    await as("MANAGER", manager.id);
    const list = await callRoute<Body<Array<{ id: string }>>>(teams.GET, { path: "/api/teams" });
    expect(list.body?.data.map((team) => team.id)).toEqual([mine.id]);
    const get = (id: string) => callRoute(teamItem.GET, { path: "/x", params: { id } });
    expect((await get(mine.id)).status).toBe(200);
    expect((await get(other.id)).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
  });

  it("refuses a deactivated team manager and audits changes", async () => {
    const gone = await makeUser("MANAGER", { status: "DEACTIVATED" });
    await as("ADMIN");
    expect((await postTeam({ name: "One", managerUserId: gone.id })).status).toBe(400);
    const id = (await postTeam({ name: "Two" })).body!.data.id;
    await callRoute(teamItem.PATCH, {
      method: "PATCH",
      path: "/x",
      params: { id },
      body: { name: "Three" },
    });
    const actions = (await prisma.auditEvent.findMany()).map((event) => event.action).sort();
    expect(actions).toEqual(["team.created", "team.updated"]);
  });
});
