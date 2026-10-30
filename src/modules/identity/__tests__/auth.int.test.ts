// W-105: sign-in rules against the real database, with a frozen clock where time matters.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as signInRoute from "@/app/api/auth/sign-in/route";
import * as signOutRoute from "@/app/api/auth/sign-out/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as usersRoute from "@/app/api/users/route";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { createTestClock, type TestClock } from "@/shared/time";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { hashPassword, syncRbac } from "..";
import { createAuthService } from "../identity.auth.service";
import { hashSessionToken } from "../identity.auth.helpers";

const prisma = getPrisma();
const PASSWORD = "Correct-Horse-Battery-9";
const WRONG = "Wrong-Horse-Battery-9";
const IP = "1.2.3.4";
let storedHash: string;

type Body = {
  data: Record<string, unknown>;
  error: { code: string; message: string; fieldErrors?: Array<{ field: string }> };
};

async function makeUser(
  status: "ACTIVE" | "DEACTIVATED" | "INVITED" = "ACTIVE",
  email = `${randomUUID()}@example.com`,
) {
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
  return prisma.identityUser.create({
    data: { email, name: "Tara Singh", passwordHash: storedHash, status, roleId: role.id },
  });
}

const signIn = (body: unknown, headers: Record<string, string> = { "x-forwarded-for": IP }) =>
  callRoute<Body>(signInRoute.POST, { method: "POST", path: "/api/auth/sign-in", body, headers });
const signOut = (headers: Record<string, string> = {}) =>
  callRoute<Body>(signOutRoute.POST, { method: "POST", path: "/api/auth/sign-out", headers });
const tokenOf = (cookie: string | null) => /eh_session=([^;]*)/.exec(cookie ?? "")?.[1] ?? "";
const own = { origin: new URL(getEnv().APP_URL).origin };

beforeEach(async () => {
  stopActing();
  await resetDatabase();
  await syncRbac();
  storedHash ??= await hashPassword(PASSWORD);
});
afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe("signing in", () => {
  it("sets the cookie, returns the profile and records the time (P1-SIGNIN-01, -10)", async () => {
    const user = await makeUser();
    const result = await signIn({ email: user.email, password: PASSWORD });
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie");
    expect(cookie).toMatch(/eh_session=.+; .*HttpOnly/);
    expect(cookie).toContain("SameSite=Lax");
    const token = tokenOf(cookie);
    expect(JSON.stringify(result.body)).not.toContain(token);
    expect(result.body?.data).toMatchObject({ id: user.id, email: user.email });
    const text = JSON.stringify(result.body);
    expect(text).not.toContain("passwordHash");
    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lastLoginAt).not.toBeNull();
    expect(
      await prisma.auditEvent.count({ where: { action: "auth.signed_in", actorUserId: user.id } }),
    ).toBe(1);
  });

  it("stores only the token's hash (P1-SESSION-08)", async () => {
    const user = await makeUser();
    const token = tokenOf(
      (await signIn({ email: user.email, password: PASSWORD })).headers.get("set-cookie"),
    );
    const session = await prisma.identitySession.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(session)).not.toContain(token);
  });

  it("the sign-in code has nothing that could log the token or password (P1-SIGNIN-10, P1-PASS-05)", () => {
    for (const file of [
      "identity.auth.service.ts",
      "identity.auth.helpers.ts",
      "identity.auth.repository.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), "src/modules/identity", file), "utf8");
      expect(source, file).not.toMatch(/logger|console\./);
    }
  });

  it("matches the email in any case with spaces around it (P1-SIGNIN-02)", async () => {
    const user = await makeUser();
    const result = await signIn({ email: `  ${user.email.toUpperCase()} `, password: PASSWORD });
    expect(result.status).toBe(200);
  });

  it("matches the password exactly (P1-SIGNIN-03)", async () => {
    const user = await makeUser();
    expect((await signIn({ email: user.email, password: PASSWORD.toLowerCase() })).status).toBe(
      401,
    );
    expect((await signIn({ email: user.email, password: `${PASSWORD} ` })).status).toBe(401);
  });

  it("gives one identical answer for every kind of failure (P1-SIGNIN-04)", async () => {
    const active = await makeUser();
    const gone = await makeUser("DEACTIVATED");
    const invited = await makeUser("INVITED");
    const results = await Promise.all([
      signIn({ email: active.email, password: WRONG }),
      signIn({ email: "nobody@example.com", password: WRONG }),
      signIn({ email: gone.email, password: PASSWORD }),
      signIn({ email: invited.email, password: PASSWORD }),
    ]);
    const answers = results.map(({ status, body }) => ({
      status,
      code: body?.error.code,
      message: body?.error.message,
    }));
    expect(answers[0]).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it("gives field messages for a missing email or password (P1-SIGNIN-05)", async () => {
    const result = await signIn({ email: "  " });
    expect(result.status).toBe(400);
    expect(result.body?.error.fieldErrors?.map((field) => field.field).sort()).toEqual([
      "email",
      "password",
    ]);
  });

  it("refuses an extremely long password like any wrong one (P1-SIGNIN-06)", async () => {
    const user = await makeUser();
    const result = await signIn({ email: user.email, password: "a".repeat(5000) });
    expect(result.status).toBe(401);
  });

  it("works with emoji and Hindi passwords (P1-SIGNIN-07)", async () => {
    const password = "Pahad-मेरा-2026🏔️";
    const user = await makeUser();
    await prisma.identityUser.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
    expect((await signIn({ email: user.email, password })).status).toBe(200);
  });

  it("gives each sign-in its own session (P1-SIGNIN-08, -09)", async () => {
    const user = await makeUser();
    const first = await signIn({ email: user.email, password: PASSWORD });
    const second = await signIn({ email: user.email, password: PASSWORD });
    expect(tokenOf(first.headers.get("set-cookie"))).not.toEqual(
      tokenOf(second.headers.get("set-cookie")),
    );
    expect(
      await prisma.identitySession.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(2);
  });
});

describe("the account lock, on a frozen clock", () => {
  let clock: TestClock;
  let auth: ReturnType<typeof createAuthService>;
  const attempt = (email: string, password: string) =>
    auth.signIn({ email, password }, { ip: IP, requestId: "req" });
  const outcome = (email: string, password: string) =>
    attempt(email, password).then(
      () => "ok",
      (error: { code: string }) => error.code,
    );

  beforeEach(() => {
    clock = createTestClock("2026-10-30T10:00:00.000Z");
    auth = createAuthService({ clock });
  });

  it("four wrong then a right one signs in and resets the count (P1-LOCK-01)", async () => {
    const user = await makeUser();
    for (let i = 0; i < 4; i += 1)
      expect(await outcome(user.email, WRONG)).toBe("INVALID_CREDENTIALS");
    expect(await outcome(user.email, PASSWORD)).toBe("ok");
    expect(
      (await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount,
    ).toBe(0);
  });

  it("the fifth locks for exactly 15 minutes, right password included, then starts fresh (P1-LOCK-02, -03, -04)", async () => {
    const user = await makeUser();
    for (let i = 0; i < 4; i += 1) await outcome(user.email, WRONG);
    expect(await outcome(user.email, WRONG)).toBe("RATE_LIMITED");
    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil?.toISOString()).toBe("2026-10-30T10:15:00.000Z");

    clock.advance({ minutes: 14, seconds: 59 });
    expect(await outcome(user.email, PASSWORD)).toBe("RATE_LIMITED");

    clock.advance({ seconds: 1 });
    expect(await outcome(user.email, WRONG)).toBe("INVALID_CREDENTIALS");
    const fresh = await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.failedLoginCount).toBe(1);
    expect(fresh.lockedUntil).toBeNull();
    expect(await outcome(user.email, PASSWORD)).toBe("ok");
  });

  it("counts five wrong passwords sent at the same moment (P1-LOCK-05)", async () => {
    const user = await makeUser();
    await Promise.all(Array.from({ length: 5 }, () => outcome(user.email, WRONG)));
    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLoginCount).toBe(5);
    expect(row.lockedUntil).not.toBeNull();
  });

  it("guesses during a lock do not extend it (P1-LOCK-06, -07)", async () => {
    const user = await makeUser();
    for (let i = 0; i < 5; i += 1) await outcome(user.email, WRONG);
    clock.advance({ minutes: 10 });
    expect(await outcome(user.email, WRONG)).toBe("RATE_LIMITED");
    const row = await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil?.toISOString()).toBe("2026-10-30T10:15:00.000Z");
  });

  it("an unknown email locks the same way, so lockout reveals nothing (P1-LOCK-08)", async () => {
    const email = "nobody@example.com";
    const answers = [];
    for (let i = 0; i < 6; i += 1) answers.push(await outcome(email, WRONG));
    expect(answers).toEqual([
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "RATE_LIMITED",
      "RATE_LIMITED",
    ]);
    clock.advance({ minutes: 15 });
    expect(await outcome(email, WRONG)).toBe("INVALID_CREDENTIALS");
    const rows = await prisma.identityLoginThrottle.findMany();
    expect(JSON.stringify(rows)).not.toContain(email);
  });

  it("a deactivated account behaves like an unknown email, right password or not", async () => {
    const user = await makeUser("DEACTIVATED");
    for (let i = 0; i < 4; i += 1)
      expect(await outcome(user.email, PASSWORD)).toBe("INVALID_CREDENTIALS");
    expect(await outcome(user.email, PASSWORD)).toBe("RATE_LIMITED");
    expect(
      (await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount,
    ).toBe(0);
  });

  it("a password changed during sign-in stops the old one getting in (P1-PASS-09)", async () => {
    const user = await makeUser();
    const racing = createAuthService({
      clock,
      verifyPassword: async () => {
        await prisma.identityUser.update({
          where: { id: user.id },
          data: { passwordHash: "changed" },
        });
        return true;
      },
    });
    await expect(
      racing.signIn({ email: user.email, password: PASSWORD }, { ip: IP }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(await prisma.identitySession.count()).toBe(0);
  });

  it("allows 20 attempts per IP and refuses the 21st until the window passes (P1-LOCK-09)", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await outcome(`u${i}@example.com`, WRONG)).toBe("INVALID_CREDENTIALS");
    }
    expect(await outcome("other@example.com", WRONG)).toBe("RATE_LIMITED");
    clock.advance({ minutes: 15 });
    expect(await outcome("other@example.com", WRONG)).toBe("INVALID_CREDENTIALS");
  });

  it("counts different IPs separately (P1-LOCK-10)", async () => {
    for (let i = 0; i < 21; i += 1) await outcome(`u${i}@example.com`, WRONG);
    await expect(
      auth.signIn({ email: "x@example.com", password: WRONG }, { ip: "5.6.7.8" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("lets exactly one of two attempts past the last allowed count (P1-LOCK-12)", async () => {
    for (let i = 0; i < 19; i += 1) await outcome(`u${i}@example.com`, WRONG);
    const results = await Promise.all([
      outcome("a@example.com", WRONG),
      outcome("b@example.com", WRONG),
    ]);
    expect(results.sort()).toEqual(["INVALID_CREDENTIALS", "RATE_LIMITED"]);
  });

  it("stores only hashes of IPs (P1-LOCK-13)", async () => {
    await outcome("a@example.com", WRONG);
    const rows = await prisma.identityLoginThrottle.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(IP);
  });

  it("audits the failure and the lock, with no personal data (P1-AUDIT-01, -05)", async () => {
    const user = await makeUser();
    for (let i = 0; i < 5; i += 1) await outcome(user.email, WRONG);
    await outcome("nobody@example.com", WRONG);
    const events = await prisma.auditEvent.findMany();
    expect(events.filter((event) => event.action === "auth.sign_in_failed")).toHaveLength(6);
    expect(
      events.filter((event) => event.action === "auth.locked" && event.entityId === user.id),
    ).toHaveLength(1);
    const unknown = events.find((event) => event.entityType === "auth");
    expect(unknown?.actorUserId).toBeNull();
    const text = JSON.stringify(events);
    for (const secret of ["nobody@example.com", user.email, WRONG, IP])
      expect(text).not.toContain(secret);
  });
});

describe("signing out", () => {
  it("ends this session only and clears the cookie (P1-SESSION-09)", async () => {
    const user = await makeUser();
    const token = tokenOf(
      (await signIn({ email: user.email, password: PASSWORD })).headers.get("set-cookie"),
    );
    await signIn({ email: user.email, password: PASSWORD });

    const result = await signOut({ cookie: `eh_session=${token}`, ...own });
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toMatch(/eh_session=;.*Max-Age=0/);
    expect(
      await prisma.identitySession.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { action: "auth.signed_out", actorUserId: user.id } }),
    ).toBe(1);
  });

  it("twice, with an unknown cookie or with none, succeeds quietly (P1-SESSION-10)", async () => {
    const user = await makeUser();
    const token = tokenOf(
      (await signIn({ email: user.email, password: PASSWORD })).headers.get("set-cookie"),
    );
    const cookie = { cookie: `eh_session=${token}`, ...own };
    expect((await signOut(cookie)).status).toBe(200);
    expect((await signOut(cookie)).status).toBe(200);
    expect((await signOut({ cookie: "eh_session=nonsense", ...own })).status).toBe(200);
    expect((await signOut()).status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { action: "auth.signed_out" } })).toBe(1);
  });
});

describe("requests from another website", () => {
  const cookie = { cookie: "eh_session=abc" };

  it("refuses a write with a session cookie and a foreign Origin (P1-CSRF-01)", async () => {
    const result = await signOut({ ...cookie, origin: "https://evil.example" });
    expect(result.status).toBe(403);
    expect(result.body?.error.code).toBe("FORBIDDEN");
  });

  it("refuses a write with a session cookie and no Origin (P1-CSRF-03)", async () => {
    expect((await signOut(cookie)).status).toBe(403);
  });

  it("allows the app's own address, which is the public one behind a proxy (P1-CSRF-02)", async () => {
    expect((await signOut({ ...cookie, ...own })).status).toBe(200);
  });

  it("applies to every guarded write, before anything else", async () => {
    actAs(await testPrincipal("ADMIN"));
    const result = await callRoute<Body>(usersRoute.POST, {
      method: "POST",
      path: "/api/users",
      headers: { ...cookie, origin: "https://evil.example" },
      body: {},
    });
    expect(result.status).toBe(403);
  });

  it("leaves a read alone, and a read changes nothing (P1-CSRF-04)", async () => {
    const user = await makeUser();
    actAs(await testPrincipal("AGENT", user.id));
    const before = await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } });
    const result = await callRoute<Body>(meRoute.GET, {
      path: "/api/auth/me",
      headers: { ...cookie, origin: "https://evil.example" },
    });
    expect(result.status).toBe(200);
    expect(result.body?.data).toMatchObject({ id: user.id });
    expect(await prisma.identityUser.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
  });
});

describe("GET /api/auth/me", () => {
  it("is 401 signed out", async () => {
    actAs(null);
    expect((await callRoute(meRoute.GET, { path: "/api/auth/me" })).status).toBe(401);
  });
});
