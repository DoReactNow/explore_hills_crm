// W-106: every request is resolved from the session cookie, on a frozen clock where time matters.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as diagnostics from "@/app/api/diagnostics/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as signInRoute from "@/app/api/auth/sign-in/route";
import * as signOutRoute from "@/app/api/auth/sign-out/route";
import * as deactivate from "@/app/api/users/[id]/deactivate/route";
import * as password from "@/app/api/users/[id]/password/route";
import * as item from "@/app/api/users/[id]/route";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { configurePrincipalResolver } from "@/shared/rbac/principalResolver";
import { createTestClock, parseInstant, type TestClock } from "@/shared/time";
import { callRoute } from "@/tests/setup/callRoute";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { createSessionPrincipalResolver, hashPassword, syncRbac } from "..";
import { authRepository } from "../identity.auth.repository";
import { hashSessionToken } from "../identity.auth.helpers";

const prisma = getPrisma();
const PASSWORD = "Correct-Horse-Battery-9";
const own = { origin: new URL(getEnv().APP_URL).origin };
const START = "2026-10-01T00:00:00.000Z";
let storedHash: string;
let clock: TestClock;
let resolve: ReturnType<typeof createSessionPrincipalResolver>;

async function makeUser(roleCode = "AGENT") {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Tara Singh",
      passwordHash: storedHash,
      status: "ACTIVE",
      roleId: role.id,
    },
  });
}

async function makeSession(userId: string, overrides: { revokedAt?: Date } = {}) {
  const token = randomUUID();
  const now = parseInstant(START);
  await prisma.identitySession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: parseInstant("2026-10-01T12:00:00.000Z"),
      ...overrides,
    },
  });
  return token;
}

const request = (token: string) => ({ headers: new Headers({ cookie: `eh_session=${token}` }) });
const sessionOf = (token: string) =>
  prisma.identitySession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(token) } });

beforeEach(async () => {
  await resetDatabase();
  await syncRbac();
  storedHash ??= await hashPassword(PASSWORD);
  clock = createTestClock(START);
  resolve = createSessionPrincipalResolver({ clock });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("how long a session lasts", () => {
  it("works at 11 h 59 min idle, and that use extends it (P1-SESSION-01)", async () => {
    const user = await makeUser();
    const token = await makeSession(user.id);
    clock.advance({ hours: 11, minutes: 59 });
    expect((await resolve(request(token)))?.userId).toBe(user.id);
    const session = await sessionOf(token);
    expect(session.expiresAt.toISOString()).toBe("2026-10-01T23:59:00.000Z");
    expect(session.lastSeenAt.toISOString()).toBe("2026-10-01T11:59:00.000Z");
  });

  it("has expired at 12 hours, the exact moment included (P1-SESSION-02, -07)", async () => {
    const user = await makeUser();
    const token = await makeSession(user.id);
    clock.advance({ hours: 12 });
    expect(await resolve(request(token))).toBeNull();
  });

  it("expires 7 days after sign-in however active (P1-SESSION-03)", async () => {
    const user = await makeUser();
    const token = await makeSession(user.id);
    for (let hour = 10; hour < 7 * 24; hour += 10) {
      clock.advance({ hours: 10 });
      expect(await resolve(request(token)), `hour ${hour}`).not.toBeNull();
    }
    expect((await sessionOf(token)).expiresAt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    clock.advance({ hours: 8 });
    expect(await resolve(request(token))).toBeNull();
  });

  it("writes activity at most once every 5 minutes (P1-SESSION-04)", async () => {
    const user = await makeUser();
    const token = await makeSession(user.id);
    clock.advance({ minutes: 5 });
    await resolve(request(token));
    const first = await sessionOf(token);
    clock.advance({ minutes: 4, seconds: 59 });
    await resolve(request(token));
    expect((await sessionOf(token)).lastSeenAt).toEqual(first.lastSeenAt);
    clock.advance({ seconds: 1 });
    await resolve(request(token));
    expect((await sessionOf(token)).lastSeenAt.getTime()).toBeGreaterThan(
      first.lastSeenAt.getTime(),
    );
  });

  it("gives many requests at once one extension write, with no errors (P1-SESSION-05)", async () => {
    const user = await makeUser();
    const token = await makeSession(user.id);
    clock.advance({ hours: 1 });
    const extend = vi.spyOn(authRepository, "extendSession");
    const results = await Promise.all(Array.from({ length: 10 }, () => resolve(request(token))));
    expect(results.every((principal) => principal?.userId === user.id)).toBe(true);
    const wrote = await Promise.all(
      extend.mock.results.map((result) => result.value as Promise<boolean>),
    );
    expect(wrote.filter(Boolean)).toHaveLength(1);
  });
});

describe("a cookie that is not a live session", () => {
  it.each(["", "nonsense", "a".repeat(5000), "%%%", "../../etc"])(
    "is signed out for %j (P1-SESSION-06)",
    async (token) => {
      expect(await resolve(request(token))).toBeNull();
    },
  );

  it("no cookie is signed out, and a tampered one too", async () => {
    const user = await makeUser();
    const token = await makeSession(user.id);
    expect(await resolve({ headers: new Headers() })).toBeNull();
    expect(await resolve(request(`${token}x`))).toBeNull();
  });

  it("a revoked session is signed out", async () => {
    const user = await makeUser();
    const token = await makeSession(user.id, { revokedAt: parseInstant(START) });
    expect(await resolve(request(token))).toBeNull();
  });

  it("the stored hash cannot be used as a cookie (P1-SESSION-08)", async () => {
    const user = await makeUser();
    const token = await makeSession(user.id);
    expect(await resolve(request(hashSessionToken(token)))).toBeNull();
  });
});

describe("the principal", () => {
  it("carries the role code, bypass flag and current grants", async () => {
    const agent = await makeUser("ADMIN");
    const principal = await resolve(request(await makeSession(agent.id)));
    expect(principal).toMatchObject({ userId: agent.id, roleCode: "ADMIN", bypassesAccess: false });
    expect(principal?.permissions.has("users:view")).toBe(true);

    const top = await makeUser("SUPER_ADMIN");
    expect(await resolve(request(await makeSession(top.id)))).toMatchObject({
      bypassesAccess: true,
    });
  });

  it("loses a removed permission on the very next request (X-ACCESS-07)", async () => {
    const user = await makeUser("ADMIN");
    const token = await makeSession(user.id);
    expect((await resolve(request(token)))?.permissions.has("users:view")).toBe(true);
    const permission = await prisma.identityPermission.findUniqueOrThrow({
      where: { code: "users:view" },
    });
    await prisma.identityRolePermission.deleteMany({ where: { permissionId: permission.id } });
    expect((await resolve(request(token)))?.permissions.has("users:view")).toBe(false);
  });
});

describe("real requests through real routes", () => {
  type Body = { error: { code: string } };
  const cookieHeaders = (token: string) => ({ cookie: `eh_session=${token}`, ...own });
  const asUser = (id: string, token: string) =>
    callRoute<Body, { id: string }>(item.GET, {
      path: `/api/users/${id}`,
      params: { id },
      headers: cookieHeaders(token),
    });
  const me = (token: string) =>
    callRoute<Body>(meRoute.GET, { path: "/api/auth/me", headers: cookieHeaders(token) });
  const signIn = async (email: string) => {
    const result = await callRoute(signInRoute.POST, {
      method: "POST",
      path: "/api/auth/sign-in",
      body: { email, password: PASSWORD },
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    return /eh_session=([^;]*)/.exec(result.headers.get("set-cookie") ?? "")?.[1] ?? "";
  };

  beforeEach(() => configurePrincipalResolver(createSessionPrincipalResolver()));
  afterEach(() => configurePrincipalResolver(async () => null));

  it("a real sign-in reaches a guarded route, and sign-out ends it", async () => {
    const user = await makeUser("ADMIN");
    const token = await signIn(user.email);
    expect((await asUser(user.id, token)).status).toBe(200);
    await callRoute(signOutRoute.POST, {
      method: "POST",
      path: "/api/auth/sign-out",
      headers: cookieHeaders(token),
    });
    expect((await asUser(user.id, token)).status).toBe(401);
  });

  it("deactivating a user makes their next request 401 (P1-SESSION-12)", async () => {
    const admin = await makeUser("ADMIN");
    const user = await makeUser();
    const adminToken = await signIn(admin.email);
    const userToken = await signIn(user.email);
    expect((await me(userToken)).status).toBe(200);
    const done = await callRoute<Body, { id: string }>(deactivate.POST, {
      method: "POST",
      path: "/x",
      params: { id: user.id },
      headers: cookieHeaders(adminToken),
      body: { openLeads: "queue" },
    });
    expect(done.status).toBe(200);
    expect((await me(userToken)).status).toBe(401);
  });

  it("a deactivated user with a live session row is still 401", async () => {
    const user = await makeUser();
    const token = await signIn(user.email);
    await prisma.identityUser.update({ where: { id: user.id }, data: { status: "DEACTIVATED" } });
    expect((await me(token)).status).toBe(401);
  });

  it("setting a password makes the user's next request 401 (P1-PASS-09)", async () => {
    const admin = await makeUser("ADMIN");
    const user = await makeUser();
    const adminToken = await signIn(admin.email);
    const userToken = await signIn(user.email);
    const done = await callRoute<Body, { id: string }>(password.POST, {
      method: "POST",
      path: "/x",
      params: { id: user.id },
      headers: cookieHeaders(adminToken),
      body: { password: "Winding-Valley-Road-77" },
    });
    expect(done.status).toBe(200);
    expect((await me(userToken)).status).toBe(401);
  });

  it("a role change applies on the next request without signing in again (P1-SESSION-13)", async () => {
    const user = await makeUser("ADMIN");
    const token = await signIn(user.email);
    const open = () =>
      callRoute<Body>(diagnostics.GET, { path: "/api/diagnostics", headers: cookieHeaders(token) });
    expect((await open()).status).toBe(200);
    const agent = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
    await prisma.identityUser.update({ where: { id: user.id }, data: { roleId: agent.id } });
    expect((await open()).status).toBe(403);
    expect((await me(token)).status).toBe(200);
  });
});
