// W-104: the user API end to end against the test database, with real rows and audit events.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as collection from "@/app/api/users/route";
import * as item from "@/app/api/users/[id]/route";
import * as deactivate from "@/app/api/users/[id]/deactivate/route";
import * as reactivate from "@/app/api/users/[id]/reactivate/route";
import * as password from "@/app/api/users/[id]/password/route";
import { getPrisma } from "@/shared/db/prisma";
import { parseInstant } from "@/shared/time";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { hashPassword, syncRbac, verifyPassword } from "..";

const prisma = getPrisma();
const STRONG = "Correct-Horse-Battery-9";
const NEW_PASSWORD = "Winding-Valley-Road-77";
const SECRET_FIELDS = ["passwordHash", "failedLoginCount", "lockedUntil", "$argon2id$"];

type Body = {
  data: Record<string, unknown>;
  error: { code: string; message: string; fieldErrors?: Array<{ field: string }> };
};

async function makeUser(
  roleCode = "AGENT",
  overrides: { status?: "ACTIVE" | "DEACTIVATED"; passwordHash?: string } = {},
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Tara Singh",
      passwordHash: overrides.passwordHash ?? "hash",
      status: overrides.status ?? "ACTIVE",
      roleId: role.id,
    },
  });
}

async function signInAs(roleCode: string) {
  const user = await makeUser(roleCode);
  actAs(await testPrincipal(roleCode, user.id));
  return user;
}

const addSession = (userId: string) =>
  prisma.identitySession.create({
    data: {
      userId,
      tokenHash: randomUUID(),
      expiresAt: parseInstant("2030-01-01T00:00:00.000Z"),
      lastSeenAt: parseInstant("2026-01-01T00:00:00.000Z"),
    },
  });

const post = (body: unknown) =>
  callRoute<Body>(collection.POST, { method: "POST", path: "/api/users", body });
const patch = (id: string, body: unknown) =>
  callRoute<Body, { id: string }>(item.PATCH, {
    method: "PATCH",
    path: `/api/users/${id}`,
    params: { id },
    body,
  });
const callAction = (mod: { POST: typeof deactivate.POST }, id: string, body?: unknown) =>
  callRoute<Body, { id: string }>(mod.POST, {
    method: "POST",
    path: `/api/users/${id}/x`,
    params: { id },
    body,
  });
const setPassword = (id: string, value = NEW_PASSWORD) =>
  callAction(password, id, { password: value });

const newUser = (overrides = {}) => ({
  email: `${randomUUID()}@Example.com`,
  name: "Asha Rao",
  password: STRONG,
  roleCode: "AGENT",
  ...overrides,
});

const auditActions = async () => (await prisma.auditEvent.findMany()).map((row) => row.action);

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

describe("access to every user route", () => {
  const calls: Array<
    [string, (id: string) => Promise<{ status: number; body: Body | null }>, string]
  > = [
    ["list", () => callRoute<Body>(collection.GET, { path: "/api/users" }), "users:view"],
    [
      "read",
      (id) =>
        callRoute<Body, { id: string }>(item.GET, { path: `/api/users/${id}`, params: { id } }),
      "users:view",
    ],
    ["create", () => post(newUser()), "users:create"],
    ["edit", (id) => patch(id, { name: "New Name" }), "users:edit"],
    ["password", (id) => setPassword(id), "users:edit"],
    ["deactivate", (id) => callAction(deactivate, id, { openLeads: "queue" }), "users:deactivate"],
    ["reactivate", (id) => callAction(reactivate, id), "users:deactivate"],
  ];

  it.each(calls)("%s: signed out is 401", async (_name, call) => {
    const target = await makeUser();
    actAs(null);
    expect((await call(target.id)).status).toBe(401);
  });

  it.each(calls)(
    "%s: an agent is refused with no permission code (P1-USER-07)",
    async (_name, call, code) => {
      const target = await makeUser();
      await signInAs("AGENT");
      const result = await call(target.id);
      expect(result.status).toBe(403);
      expect(JSON.stringify(result.body)).not.toContain(code);
    },
  );

  it.each(calls)("%s: an Admin may", async (_name, call) => {
    const target = await makeUser();
    await signInAs("ADMIN");
    expect((await call(target.id)).status).toBeLessThan(300);
  });

  it.each(calls)("%s: a Super Admin may, through the bypass (X-ACCESS-04)", async (_name, call) => {
    const target = await makeUser();
    await signInAs("SUPER_ADMIN");
    expect((await call(target.id)).status).toBeLessThan(300);
  });

  it("a Manager can view but not change users (P1-USER-06)", async () => {
    const target = await makeUser();
    await signInAs("MANAGER");
    expect((await callRoute<Body>(collection.GET, { path: "/api/users" })).status).toBe(200);
    expect((await patch(target.id, { name: "New Name" })).status).toBe(403);
    expect((await post(newUser())).status).toBe(403);
    expect((await callAction(deactivate, target.id, { openLeads: "queue" })).status).toBe(403);
  });
});

describe("creating a user", () => {
  beforeEach(() => signInAs("ADMIN"));

  it("stores a lowercase email, an argon2id hash and an ACTIVE user, and audits it (P1-USER-01, P1-PASS-07)", async () => {
    const email = `${randomUUID()}@Example.COM`;
    const result = await post(newUser({ email }));
    expect(result.status).toBe(201);
    const row = await prisma.identityUser.findUniqueOrThrow({
      where: { email: email.toLowerCase() },
    });
    expect(row.status).toBe("ACTIVE");
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(STRONG, row.passwordHash)).toBe(true);
    expect(await auditActions()).toEqual(["user.created"]);
    const audit = JSON.stringify(await prisma.auditEvent.findMany());
    expect(audit).not.toContain(STRONG);
    expect(audit).not.toContain(row.passwordHash);
  });

  it("gives friendly field messages for bad input (X-INPUT-01)", async () => {
    const result = await post({ email: "nope", name: "  ", password: "weak", roleCode: "AGENT" });
    expect(result.status).toBe(400);
    expect(result.body?.error.code).toBe("VALIDATION_FAILED");
    expect(result.body?.error.fieldErrors?.map((field) => field.field)).toEqual(
      expect.arrayContaining(["email", "name"]),
    );
  });

  it("refuses a weak password, repeating nothing (P1-PASS-02)", async () => {
    const result = await post(newUser({ password: "alllowercaseletters" }));
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).not.toContain("alllowercaseletters");
    expect(await auditActions()).toEqual([]);
  });

  it("refuses a role that does not exist (P1-USER-05)", async () => {
    expect((await post(newUser({ roleCode: "NOPE" }))).status).toBe(400);
  });

  it("refuses a taken email in any case, and a refused change is not audited (P1-USER-02)", async () => {
    const email = `${randomUUID()}@example.com`;
    expect((await post(newUser({ email }))).status).toBe(201);
    const second = await post(newUser({ email: email.toUpperCase() }));
    expect(second.status).toBe(409);
    expect(await auditActions()).toEqual(["user.created"]);
  });

  it("creates one user from two simultaneous requests (P1-USER-02)", async () => {
    const email = `${randomUUID()}@example.com`;
    const results = await Promise.all([post(newUser({ email })), post(newUser({ email }))]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await prisma.identityUser.count({ where: { email } })).toBe(1);
  });

  it("keeps a deactivated user's email taken (P1-USER-03)", async () => {
    const gone = await makeUser("AGENT", { status: "DEACTIVATED" });
    expect((await post(newUser({ email: gone.email }))).status).toBe(409);
  });

  it("stores Hindi names and apostrophes, and treats markup as text (X-INPUT-04, -05)", async () => {
    for (const name of ["सुनीता अग्रवाल", "D'Souza", "<script>alert(1)</script>"]) {
      const result = await post(newUser({ name }));
      expect(result.body?.data.name).toBe(name);
    }
  });
});

describe("reading users", () => {
  it("never returns the hash, failed count or lock time (P1-USER-11, P1-PASS-05)", async () => {
    const target = await makeUser("AGENT", { passwordHash: await hashPassword(STRONG) });
    await signInAs("ADMIN");
    const list = await callRoute<Body>(collection.GET, { path: "/api/users" });
    const one = await callRoute<Body, { id: string }>(item.GET, {
      path: `/api/users/${target.id}`,
      params: { id: target.id },
    });
    const edited = await patch(target.id, { name: "New Name" });
    const created = await post(newUser());
    const text = JSON.stringify([list.body, one.body, edited.body, created.body]);
    for (const secret of SECRET_FIELDS) expect(text).not.toContain(secret);
    expect(one.body?.data).toMatchObject({
      id: target.id,
      status: "ACTIVE",
      role: { code: "AGENT" },
    });
  });

  it("pages the list and reports the total", async () => {
    await makeUser();
    await makeUser();
    await signInAs("ADMIN");
    const result = await callRoute<{ data: { items: unknown[]; total: number } }>(collection.GET, {
      path: "/api/users?page=1&pageSize=2",
    });
    expect(result.body?.data.items).toHaveLength(2);
    expect(result.body?.data.total).toBe(3);
  });

  it("gives not found for an unknown or malformed ID (X-INPUT-07)", async () => {
    await signInAs("ADMIN");
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const result = await callRoute<Body, { id: string }>(item.GET, {
        path: `/api/users/${id}`,
        params: { id },
      });
      expect(result.status).toBe(404);
    }
  });
});

describe("editing a user", () => {
  it("ignores password, lock and status fields in an ordinary edit (P1-USER-04, X-INPUT-02)", async () => {
    const target = await makeUser();
    await signInAs("ADMIN");
    const result = await patch(target.id, {
      name: "New Name",
      passwordHash: "stolen",
      password: NEW_PASSWORD,
      status: "DEACTIVATED",
      failedLoginCount: 9,
      lockedUntil: "2030-01-01T00:00:00.000Z",
    });
    expect(result.status).toBe(200);
    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: target.id } });
    expect(row).toMatchObject({
      name: "New Name",
      passwordHash: "hash",
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
    });
    expect(await auditActions()).toEqual(["user.updated"]);
  });

  it("audits a role change separately, by role code (P1-AUDIT-01)", async () => {
    const target = await makeUser();
    await signInAs("ADMIN");
    await patch(target.id, { roleCode: "MANAGER" });
    const rows = await prisma.auditEvent.findMany();
    expect(rows.map((row) => row.action)).toEqual(["user.role_changed"]);
    expect(rows[0].metadata).toMatchObject({ fromRole: "AGENT", toRole: "MANAGER" });
  });
});

describe("deactivating and reactivating", () => {
  it("ends all sessions, and reactivating restores sign-in but not them (P1-SESSION-12, P1-USER-09)", async () => {
    const target = await makeUser();
    await addSession(target.id);
    await addSession(target.id);
    await signInAs("ADMIN");

    expect((await callAction(deactivate, target.id, { openLeads: "queue" })).status).toBe(200);
    let row = await prisma.identityUser.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe("DEACTIVATED");
    expect(row.deactivatedAt).not.toBeNull();
    expect(
      await prisma.identitySession.count({ where: { userId: target.id, revokedAt: null } }),
    ).toBe(0);

    expect((await callAction(reactivate, target.id)).status).toBe(200);
    row = await prisma.identityUser.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe("ACTIVE");
    expect(row.deactivatedAt).toBeNull();
    expect(
      await prisma.identitySession.count({ where: { userId: target.id, revokedAt: null } }),
    ).toBe(0);
    expect(await auditActions()).toEqual(["user.deactivated", "user.reactivated"]);
  });
});

describe("setting a password", () => {
  it("swaps the password, signs the user out, clears the lock and audits (P1-PASS-09, -10, -12)", async () => {
    const target = await makeUser("AGENT", { passwordHash: await hashPassword(STRONG) });
    await prisma.identityUser.update({
      where: { id: target.id },
      data: { failedLoginCount: 5, lockedUntil: parseInstant("2030-01-01T00:00:00.000Z") },
    });
    await addSession(target.id);
    await signInAs("ADMIN");

    expect((await setPassword(target.id)).status).toBe(200);

    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: target.id } });
    expect(await verifyPassword(STRONG, row.passwordHash)).toBe(false);
    expect(await verifyPassword(NEW_PASSWORD, row.passwordHash)).toBe(true);
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(
      await prisma.identitySession.count({ where: { userId: target.id, revokedAt: null } }),
    ).toBe(0);

    const events = await prisma.auditEvent.findMany();
    expect(events.map((event) => event.action)).toEqual(["user.password_changed"]);
    expect(events[0].entityId).toBe(target.id);
    expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD);
  });

  it("refuses a weak password and changes nothing", async () => {
    const target = await makeUser();
    await signInAs("ADMIN");
    expect((await setPassword(target.id, "weak")).status).toBe(400);
    expect(
      (await prisma.identityUser.findUniqueOrThrow({ where: { id: target.id } })).passwordHash,
    ).toBe("hash");
  });

  it("refuses your own password, for an Admin and a Super Admin (P1-PASS-08)", async () => {
    for (const roleCode of ["ADMIN", "SUPER_ADMIN"]) {
      const me = await signInAs(roleCode);
      expect((await setPassword(me.id)).status).toBe(403);
    }
  });

  it("an Admin cannot change a Super Admin's password; a Super Admin can (P1-PASS-11)", async () => {
    const target = await makeUser("SUPER_ADMIN");
    await signInAs("ADMIN");
    expect((await setPassword(target.id)).status).toBe(403);
    await signInAs("SUPER_ADMIN");
    expect((await setPassword(target.id)).status).toBe(200);
  });
});

describe("Super Admin protections", () => {
  it("an Admin is refused on every action, and nothing is audited (P1-SUPER-01)", async () => {
    const target = await makeUser("SUPER_ADMIN");
    await signInAs("ADMIN");
    const results = await Promise.all([
      patch(target.id, { name: "Changed" }),
      patch(target.id, { roleCode: "AGENT" }),
      callAction(deactivate, target.id, { openLeads: "queue" }),
      setPassword(target.id),
      post(newUser({ roleCode: "SUPER_ADMIN" })),
    ]);
    expect(results.map((result) => result.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await auditActions()).toEqual([]);
  });

  it("an Admin cannot promote anyone, and cannot reactivate a Super Admin", async () => {
    const agent = await makeUser();
    const gone = await makeUser("SUPER_ADMIN", { status: "DEACTIVATED" });
    await signInAs("ADMIN");
    expect((await patch(agent.id, { roleCode: "SUPER_ADMIN" })).status).toBe(403);
    expect((await callAction(reactivate, gone.id)).status).toBe(403);
  });

  it("the last active Super Admin cannot be demoted; a deactivated one does not count (P1-SUPER-04, -06)", async () => {
    const last = await makeUser("SUPER_ADMIN");
    await makeUser("SUPER_ADMIN", { status: "DEACTIVATED" });
    const actor = await makeUser("ADMIN");
    actAs({ ...(await testPrincipal("SUPER_ADMIN", actor.id)) });
    expect((await patch(last.id, { roleCode: "AGENT" })).status).toBe(409);
    expect((await callAction(deactivate, last.id, { openLeads: "queue" })).status).toBe(409);
  });

  it("two Super Admins deactivating each other leave one active (P1-SUPER-05)", async () => {
    const first = await makeUser("SUPER_ADMIN");
    const second = await makeUser("SUPER_ADMIN");
    const [firstCard, secondCard] = await Promise.all([
      testPrincipal("SUPER_ADMIN", first.id),
      testPrincipal("SUPER_ADMIN", second.id),
    ]);
    // Each request resolves its principal first, so switch cards between the two calls.
    actAs(firstCard);
    const removeSecond = callAction(deactivate, second.id, { openLeads: "queue" });
    actAs(secondCard);
    const removeFirst = callAction(deactivate, first.id, { openLeads: "queue" });
    const statuses = (await Promise.all([removeSecond, removeFirst])).map(
      (result) => result.status,
    );
    expect(
      await prisma.identityUser.count({
        where: { status: "ACTIVE", role: { code: "SUPER_ADMIN" } },
      }),
    ).toBe(1);
    expect(statuses.sort()).toEqual([200, 409]);
  });

  it("reserved permissions cannot be granted, and the bypass cannot move (P1-SUPER-08, -09)", async () => {
    const reserved = await prisma.identityPermission.findUniqueOrThrow({
      where: { code: "roles:manage" },
    });
    const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: "ADMIN" } });
    await expect(
      prisma.identityRolePermission.create({
        data: { roleId: role.id, permissionId: reserved.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.identityRole.update({ where: { id: role.id }, data: { bypassesAccess: true } }),
    ).rejects.toThrow();
  });
});

describe("no route can do more than it should", () => {
  const dir = join(process.cwd(), "src/app/api/users");
  const routeFiles = (path: string): string[] =>
    readdirSync(path).flatMap((name) => {
      const full = join(path, name);
      return statSync(full).isDirectory() ? routeFiles(full) : [full];
    });

  it("has no DELETE, no bulk route and no self-service or forgot-password route (P1-USER-08, P1-SUPER-02, P1-PASS-08)", () => {
    const files = routeFiles(dir).map((file) => file.slice(dir.length));
    expect(files.sort()).toEqual(
      [
        "/[id]/deactivate/route.ts",
        "/[id]/password/route.ts",
        "/[id]/reactivate/route.ts",
        "/[id]/route.ts",
        "/route.ts",
      ].sort(),
    );
    for (const file of routeFiles(dir)) {
      expect(readFileSync(file, "utf8")).not.toMatch(/export const DELETE/);
    }
    expect(routeFiles(join(process.cwd(), "src/app/api")).join("\n")).not.toMatch(
      /forgot|reset-password/i,
    );
  });
});
