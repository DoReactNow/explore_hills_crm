// Phase 2: the Roles & Permissions rules (Decision 23) through the real API.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as reset from "@/app/api/roles/[id]/reset/route";
import * as item from "@/app/api/roles/[id]/route";
import * as options from "@/app/api/roles/options/route";
import * as roles from "@/app/api/roles/route";
import { getPrisma } from "@/shared/db/prisma";
import { DEFAULT_ROLES } from "@/shared/rbac/defaultRoles";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { syncRbac } from "..";

const prisma = getPrisma();
type Role = {
  id: string;
  code: string;
  name: string;
  locked: boolean;
  userCount: number;
  permissions: string[];
  defaultPermissions: string[] | null;
  version: string;
};
type Body<T> = {
  data: T;
  error: { code: string; message: string; fieldErrors?: Array<{ field: string; message: string }> };
};
type Id = { id: string };

async function makeUser(roleCode: string) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Tara Singh",
      passwordHash: "hash",
      status: "ACTIVE",
      roleId: role.id,
    },
  });
}
const asSuper = async () =>
  actAs(await testPrincipal("SUPER_ADMIN", (await makeUser("SUPER_ADMIN")).id));
const list = async () =>
  (
    await callRoute<Body<{ roles: Role[]; permissions: Array<{ code: string }> }>>(roles.GET, {
      path: "/api/roles",
    })
  ).body!.data;
const findRole = async (code: string) => (await list()).roles.find((role) => role.code === code)!;
const create = (body: unknown) =>
  callRoute<Body<Role>>(roles.POST, { method: "POST", path: "/api/roles", body });
const patch = (id: string, body: unknown) =>
  callRoute<Body<Role>, Id>(item.PATCH, { method: "PATCH", path: "/x", params: { id }, body });
const del = (id: string) =>
  callRoute<Body<unknown>, Id>(item.DELETE, { method: "DELETE", path: "/x", params: { id } });
const resetRole = (id: string, version: string) =>
  callRoute<Body<Role>, Id>(reset.POST, {
    method: "POST",
    path: "/x",
    params: { id },
    body: { version },
  });

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

describe("access", () => {
  it("an Admin is refused on every role route (P2-ROLES-01)", async () => {
    actAs(await testPrincipal("ADMIN", (await makeUser("ADMIN")).id));
    const target = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
    const results = await Promise.all([
      callRoute(roles.GET, { path: "/api/roles" }),
      create({ name: "New" }),
      patch(target.id, { version: target.updatedAt.toISOString() }),
      del(target.id),
      resetRole(target.id, target.updatedAt.toISOString()),
    ]);
    expect(results.map((result) => result.status)).toEqual([403, 403, 403, 403, 403]);
  });

  it("the picker hides the Super Admin role from an Admin (P2-UMGMT-02)", async () => {
    actAs(await testPrincipal("ADMIN", (await makeUser("ADMIN")).id));
    const seen = await callRoute<Body<Array<{ code: string }>>>(options.GET, { path: "/x" });
    expect(seen.body?.data.map((role) => role.code)).not.toContain("SUPER_ADMIN");
    await asSuper();
    const all = await callRoute<Body<Array<{ code: string }>>>(options.GET, { path: "/x" });
    expect(all.body?.data.map((role) => role.code)).toContain("SUPER_ADMIN");
  });
});

describe("the list", () => {
  it("shows user counts, and never offers reserved permissions (P2-ROLES-06)", async () => {
    await asSuper();
    await makeUser("AGENT");
    const { roles: rows, permissions } = await list();
    expect(rows.find((role) => role.code === "AGENT")?.userCount).toBe(1);
    expect(rows.find((role) => role.code === "SUPER_ADMIN")?.locked).toBe(true);
    const codes = permissions.map((permission) => permission.code);
    expect(codes).toContain("users:view");
    expect(codes).not.toContain("roles:manage");
    expect(codes).not.toContain("users:manage-super-admins");
  });
});

describe("creating and renaming", () => {
  it("creates from a name, with a stable code and a copied bundle, and audits it", async () => {
    await asSuper();
    const created = await create({ name: "Team Lead", copyFromCode: "MANAGER" });
    expect(created.status).toBe(201);
    expect(created.body?.data.code).toBe("TEAM_LEAD");
    expect(created.body?.data.permissions).toEqual(["teams:view", "users:view"]);

    const renamed = await patch(created.body!.data.id, {
      name: "Shift Lead",
      version: created.body!.data.version,
    });
    expect(renamed.body?.data).toMatchObject({ name: "Shift Lead", code: "TEAM_LEAD" }); // P2-ROLES-03
    const actions = (await prisma.auditEvent.findMany()).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(["role.created", "role.updated"]));
  });

  it("works with a Hindi name", async () => {
    await asSuper();
    const created = await create({ name: "टीम लीड" });
    expect(created.status).toBe(201);
    expect(created.body?.data.code).toMatch(/^ROLE_/);
    expect(created.body?.data.name).toBe("टीम लीड");
  });

  it("refuses a duplicate name or code in any case, with a friendly message (P2-ROLES-02)", async () => {
    await asSuper();
    await create({ name: "Team Lead" });
    for (const name of ["TEAM LEAD", "team-lead", "agent"]) {
      const result = await create({ name });
      expect(result.status, name).toBe(409);
      expect(result.body?.error.fieldErrors?.[0].field).toBe("name");
    }
  });

  it("refuses renaming a built-in role, or copying the Super Admin (P2-ROLES-03)", async () => {
    await asSuper();
    const agent = await findRole("AGENT");
    expect((await patch(agent.id, { name: "Rep", version: agent.version })).status).toBe(409);
    expect((await create({ name: "Almost", copyFromCode: "SUPER_ADMIN" })).status).toBe(400);
  });
});

describe("editing permissions", () => {
  it("changes a role, the Admin role included, and audits what changed", async () => {
    await asSuper();
    const admin = await findRole("ADMIN");
    const result = await patch(admin.id, {
      permissions: ["users:view"],
      version: admin.version,
    });
    expect(result.status).toBe(200);
    expect(result.body?.data.permissions).toEqual(["users:view"]);
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "role.permissions_changed" },
    });
    expect(event.metadata).toMatchObject({
      added: [],
      removed: expect.arrayContaining(["users:edit"]),
    });
  });

  it("refuses reserved and unknown permissions (P2-ROLES-06, -07, P1-SUPER-08)", async () => {
    await asSuper();
    const agent = await findRole("AGENT");
    for (const code of ["roles:manage", "users:manage-super-admins", "made:up"]) {
      const result = await patch(agent.id, { permissions: [code], version: agent.version });
      expect(result.status, code).toBe(400);
    }
  });

  it("allows removing every permission (P2-ROLES-09)", async () => {
    await asSuper();
    const manager = await findRole("MANAGER");
    const result = await patch(manager.id, { permissions: [], version: manager.version });
    expect(result.body?.data.permissions).toEqual([]);
  });

  it("two people editing from the same version: the second is told (P2-ROLES-08)", async () => {
    await asSuper();
    const agent = await findRole("AGENT");
    const first = await patch(agent.id, { permissions: ["users:view"], version: agent.version });
    expect(first.status).toBe(200);
    const second = await patch(agent.id, { permissions: ["teams:view"], version: agent.version });
    expect(second.status).toBe(409);
    expect((await findRole("AGENT")).permissions).toEqual(["users:view"]);
  });

  it("simultaneous edits from one version: exactly one wins (P2-ROLES-08)", async () => {
    await asSuper();
    const agent = await findRole("AGENT");
    const results = await Promise.all([
      patch(agent.id, { permissions: ["users:view"], version: agent.version }),
      patch(agent.id, { permissions: ["teams:view"], version: agent.version }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it("the Super Admin role cannot be edited or deleted (P2-ROLES-05)", async () => {
    await asSuper();
    const top = await findRole("SUPER_ADMIN");
    expect(
      (await patch(top.id, { permissions: ["users:view"], version: top.version })).status,
    ).toBe(409);
    expect((await patch(top.id, { name: "Boss", version: top.version })).status).toBe(409);
    expect((await del(top.id)).status).toBe(409);
    expect((await resetRole(top.id, top.version)).status).toBe(409);
  });
});

describe("deleting", () => {
  it("removes an unused custom role, and audits it", async () => {
    await asSuper();
    const created = await create({ name: "Temp" });
    expect((await del(created.body!.data.id)).status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { action: "role.deleted" } })).toBe(1);
  });

  it("refuses a role still held by someone, with a friendly message (P2-ROLES-04)", async () => {
    await asSuper();
    const created = await create({ name: "Held" });
    await makeUser("HELD");
    const result = await del(created.body!.data.id);
    expect(result.status).toBe(409);
    expect(result.body?.error.fieldErrors?.[0].message).toMatch(/still have this role/);
    expect(await prisma.identityRole.count({ where: { code: "HELD" } })).toBe(1);
  });

  it("refuses system roles (P2-ROLES-05)", async () => {
    await asSuper();
    expect((await del((await findRole("AGENT")).id)).status).toBe(409);
  });

  it("gives not found for a malformed or unknown ID", async () => {
    await asSuper();
    expect((await del("not-a-uuid")).status).toBe(404);
    expect((await del(randomUUID())).status).toBe(404);
  });
});

describe("reset to defaults", () => {
  it("restores the bundle from code and audits what changed (P2-ROLES-10)", async () => {
    await asSuper();
    const admin = await findRole("ADMIN");
    const edited = await patch(admin.id, { permissions: ["users:view"], version: admin.version });
    expect(edited.body?.data.defaultPermissions).toEqual(
      [...DEFAULT_ROLES.ADMIN.permissions].sort(),
    );

    const result = await resetRole(admin.id, edited.body!.data.version);
    expect(result.body?.data.permissions).toEqual([...DEFAULT_ROLES.ADMIN.permissions].sort());
    const events = await prisma.auditEvent.findMany({
      where: { action: "role.permissions_changed" },
    });
    expect(events.at(-1)?.metadata).toMatchObject({ reset: true, removed: [] });
  });

  it("does nothing to a custom role (P2-ROLES-10)", async () => {
    await asSuper();
    const created = await create({ name: "Custom", copyFromCode: "MANAGER" });
    const result = await resetRole(created.body!.data.id, created.body!.data.version);
    expect(result.status).toBe(409);
    expect((await findRole("CUSTOM")).permissions).toEqual(["teams:view", "users:view"]);
  });
});

describe("with the RBAC sync", () => {
  it("edits survive a sync (P2-ROLES-11)", async () => {
    await asSuper();
    const manager = await findRole("MANAGER");
    await patch(manager.id, { permissions: [], version: manager.version });
    await syncRbac();
    expect((await findRole("MANAGER")).permissions).toEqual([]);
  });

  it("a permission gone from the code leaves the page and every role (P2-ROLES-12)", async () => {
    await asSuper();
    const stale = await prisma.identityPermission.create({
      data: { code: "old:thing", label: "Old", description: "", module: "x" },
    });
    const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
    await prisma.identityRolePermission.create({
      data: { roleId: role.id, permissionId: stale.id },
    });
    expect((await findRole("AGENT")).permissions).not.toContain("old:thing");
    expect((await list()).permissions.map((p) => p.code)).not.toContain("old:thing");
    await syncRbac();
    expect(await prisma.identityPermission.count({ where: { code: "old:thing" } })).toBe(0);
  });
});
