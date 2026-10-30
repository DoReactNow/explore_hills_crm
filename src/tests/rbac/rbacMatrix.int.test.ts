// W-109: every guarded route, called with a real sign-in as every seeded role. Adding a route without
// adding it here fails the scan below, so nothing new goes unproven.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTestSeed } from "@seeds/testSeed";
import * as me from "@/app/api/auth/me/route";
import * as signIn from "@/app/api/auth/sign-in/route";
import * as signOut from "@/app/api/auth/sign-out/route";
import * as diagnostics from "@/app/api/diagnostics/route";
import * as stream from "@/app/api/events/stream/route";
import * as health from "@/app/api/health/route";
import * as fail from "@/app/api/test-support/fail/route";
import * as deactivate from "@/app/api/users/[id]/deactivate/route";
import * as password from "@/app/api/users/[id]/password/route";
import * as reactivate from "@/app/api/users/[id]/reactivate/route";
import * as item from "@/app/api/users/[id]/route";
import * as collection from "@/app/api/users/route";
import { createSessionPrincipalResolver, createUserIfMissing } from "@/modules/identity";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { configurePrincipalResolver } from "@/shared/rbac/principalResolver";
import { resetDatabase } from "@/tests/setup/resetDatabase";

const prisma = getPrisma();
const origin = new URL(getEnv().APP_URL).origin;
const env = process.env as Record<string, string>;
const CUSTOM_ROLE = { email: "team.viewer.test@example.com", password: env.TEST_ADMIN_PASSWORD };

const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "AGENT", "TEAM_VIEWER"] as const;
type Role = (typeof ROLES)[number];
type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

const credentials = (role: Role) =>
  role === "TEAM_VIEWER"
    ? CUSTOM_ROLE
    : { email: env[`TEST_${role}_EMAIL`], password: env[`TEST_${role}_PASSWORD`] };

const EVERYONE: readonly Role[] = ROLES;
const USERS_VIEW: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEAM_VIEWER"];
const ADMINS: readonly Role[] = ["SUPER_ADMIN", "ADMIN"];

interface Case {
  method: string;
  path: string;
  handler: unknown;
  /** Roles allowed through; "public" routes also answer someone signed out. */
  allowed: readonly Role[] | "public";
  usesId?: boolean;
  body?: unknown;
}

const CASES: Case[] = [
  { method: "GET", path: "/api/health", handler: health.GET, allowed: "public" },
  { method: "GET", path: "/api/test-support/fail", handler: fail.GET, allowed: "public" },
  { method: "POST", path: "/api/auth/sign-in", handler: signIn.POST, allowed: "public", body: {} },
  { method: "POST", path: "/api/auth/sign-out", handler: signOut.POST, allowed: "public" },
  { method: "GET", path: "/api/auth/me", handler: me.GET, allowed: EVERYONE },
  { method: "GET", path: "/api/events/stream", handler: stream.GET, allowed: EVERYONE },
  { method: "GET", path: "/api/diagnostics", handler: diagnostics.GET, allowed: ADMINS },
  { method: "GET", path: "/api/users", handler: collection.GET, allowed: USERS_VIEW },
  { method: "POST", path: "/api/users", handler: collection.POST, allowed: ADMINS, body: {} },
  { method: "GET", path: "/api/users/[id]", handler: item.GET, allowed: USERS_VIEW, usesId: true },
  {
    method: "PATCH",
    path: "/api/users/[id]",
    handler: item.PATCH,
    allowed: ADMINS,
    usesId: true,
    body: {},
  },
  {
    method: "POST",
    path: "/api/users/[id]/password",
    handler: password.POST,
    allowed: ADMINS,
    usesId: true,
    body: {},
  },
  {
    method: "POST",
    path: "/api/users/[id]/deactivate",
    handler: deactivate.POST,
    allowed: ADMINS,
    usesId: true,
  },
  {
    method: "POST",
    path: "/api/users/[id]/reactivate",
    handler: reactivate.POST,
    allowed: ADMINS,
    usesId: true,
  },
];

async function call(testCase: Case, headers: Record<string, string>) {
  const target = testCase.usesId ? await createTarget() : "";
  const url = new URL(testCase.path.replace("[id]", target), origin);
  const response = await (testCase.handler as Handler)(
    new Request(url, {
      method: testCase.method,
      headers: { "content-type": "application/json", ...headers },
      body: testCase.body === undefined ? undefined : JSON.stringify(testCase.body),
    }),
    { params: Promise.resolve({ id: target }) as Promise<never> },
  );
  // The live-update stream never ends, so read a body only when it is the JSON envelope.
  const isStream = response.headers.get("content-type")?.includes("text/event-stream");
  const text = isStream ? "" : await response.text();
  if (isStream) await response.body?.cancel();
  return { status: response.status, text };
}

async function createTarget(): Promise<string> {
  const agent = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
  const user = await prisma.identityUser.create({
    data: {
      email: `${randomUUID()}@example.com`,
      name: "Matrix Target",
      passwordHash: "unused",
      status: "ACTIVE",
      roleId: agent.id,
    },
  });
  return user.id;
}

let nextIp = 0;
async function signedInHeaders(role: Role): Promise<Record<string, string>> {
  nextIp += 1;
  const response = await (signIn.POST as unknown as Handler)(
    new Request(new URL("/api/auth/sign-in", origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.1.${Math.floor(nextIp / 250)}.${(nextIp % 250) + 1}`,
      },
      body: JSON.stringify(credentials(role)),
    }),
    { params: Promise.resolve({}) as Promise<never> },
  );
  expect(response.status, `${role} signs in`).toBe(200);
  const token = /eh_session=([^;]*)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  return { cookie: `eh_session=${token}`, origin };
}

beforeAll(async () => {
  await resetDatabase();
  await runTestSeed();
  await createUserIfMissing({
    ...CUSTOM_ROLE,
    name: "Tina Sample",
    roleCode: "TEAM_VIEWER",
  });
  configurePrincipalResolver(createSessionPrincipalResolver());
});
afterAll(async () => {
  configurePrincipalResolver(async () => null);
  await resetDatabase();
  await prisma.$disconnect();
});

describe("every route, as every role, with a real session", () => {
  const rows = CASES.flatMap((testCase) =>
    ROLES.map((role) => ({ name: `${testCase.method} ${testCase.path}`, role, testCase })),
  );

  it.each(rows)("$name as $role", async ({ role, testCase }) => {
    const { status, text } = await call(testCase, await signedInHeaders(role));
    const allowed = testCase.allowed === "public" || testCase.allowed.includes(role);
    if (allowed) {
      expect([401, 403]).not.toContain(status);
    } else {
      expect(status).toBe(403);
      expect(text).not.toMatch(/[a-z]+(-[a-z]+)*:[a-z]+(-[a-z]+)*/); // no permission code
    }
  });

  it.each(CASES.map((testCase) => ({ name: `${testCase.method} ${testCase.path}`, testCase })))(
    "$name signed out",
    async ({ testCase }) => {
      const { status } = await call(testCase, {});
      if (testCase.allowed === "public") expect(status).not.toBe(401);
      else expect(status).toBe(401);
    },
  );
});

describe("the matrix", () => {
  const API = join(process.cwd(), "src/app/api");
  const METHODS = /export const (GET|POST|PUT|PATCH|DELETE)\b/g;
  const routeFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return routeFiles(path);
      return name === "route.ts" ? [path] : [];
    });

  it("covers every route handler that exists, and nothing that does not", () => {
    const existing = routeFiles(API).flatMap((file) => {
      const path = `/api/${relative(API, file).split(sep).slice(0, -1).join("/")}`;
      return [...readFileSync(file, "utf8").matchAll(METHODS)].map((m) => `${m[1]} ${path}`);
    });
    expect(CASES.map((c) => `${c.method} ${c.path}`).sort()).toEqual(existing.sort());
  });

  it("includes every seeded role, the custom one and the Super Admin among them", async () => {
    const seeded = await prisma.identityRole.findMany({
      where: { users: { some: {} } },
      select: { code: true },
    });
    expect(seeded.map((role) => role.code).sort()).toEqual([...ROLES].sort());
  });
});
