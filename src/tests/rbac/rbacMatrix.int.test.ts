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
import * as chatStart from "@/app/api/leads/[id]/conversation/route";
import * as chatMedia from "@/app/api/conversations/[id]/media/route";
import * as chatMessages from "@/app/api/conversations/[id]/messages/route";
import * as chatOptIn from "@/app/api/conversations/[id]/opt-in/route";
import * as chatRead from "@/app/api/conversations/[id]/read/route";
import * as chatTemplate from "@/app/api/conversations/[id]/template/route";
import * as chatItem from "@/app/api/conversations/[id]/route";
import * as chats from "@/app/api/conversations/route";
import * as leadMerge from "@/app/api/leads/[id]/merge/route";
import * as messageMedia from "@/app/api/messages/[id]/media/route";
import * as messageRetry from "@/app/api/messages/[id]/retry/route";
import * as templateItem from "@/app/api/templates/[id]/route";
import * as templates from "@/app/api/templates/route";
import * as whatsapp from "@/app/api/webhooks/whatsapp/route";
import * as followUps from "@/app/api/follow-ups/route";
import * as leadNotes from "@/app/api/leads/[id]/notes/route";
import * as leadStage from "@/app/api/leads/[id]/stage/route";
import * as leadTask from "@/app/api/leads/[id]/tasks/[taskId]/route";
import * as leadTasks from "@/app/api/leads/[id]/tasks/route";
import * as leadItem from "@/app/api/leads/[id]/route";
import * as leadStages from "@/app/api/leads/stages/route";
import * as leads from "@/app/api/leads/route";
import * as settings from "@/app/api/settings/route";
import * as settingStage from "@/app/api/settings/stages/[id]/route";
import * as settingStages from "@/app/api/settings/stages/route";
import * as roleOptions from "@/app/api/roles/options/route";
import * as roleReset from "@/app/api/roles/[id]/reset/route";
import * as roleItem from "@/app/api/roles/[id]/route";
import * as roles from "@/app/api/roles/route";
import * as teamMember from "@/app/api/teams/[id]/members/[userId]/route";
import * as teamMembers from "@/app/api/teams/[id]/members/route";
import * as teamItem from "@/app/api/teams/[id]/route";
import * as teams from "@/app/api/teams/route";
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
const SUPER_ONLY: readonly Role[] = ["SUPER_ADMIN"];
const LEAD_ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "AGENT"];
const MERGE_ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
const TEAM_VIEW: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER"];

interface Case {
  method: string;
  path: string;
  handler: unknown;
  /** Roles allowed through; "public" routes also answer someone signed out. */
  allowed: readonly Role[] | "public" | "signed";
  usesId?: "user" | "team" | "role" | "lead" | "stage";
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
  {
    method: "GET",
    path: "/api/users/[id]",
    handler: item.GET,
    allowed: USERS_VIEW,
    usesId: "user",
  },
  {
    method: "PATCH",
    path: "/api/users/[id]",
    handler: item.PATCH,
    allowed: ADMINS,
    usesId: "user",
    body: {},
  },
  {
    method: "POST",
    path: "/api/users/[id]/password",
    handler: password.POST,
    allowed: ADMINS,
    usesId: "user",
    body: {},
  },
  {
    method: "POST",
    path: "/api/users/[id]/deactivate",
    handler: deactivate.POST,
    allowed: ADMINS,
    usesId: "user",
  },
  {
    method: "POST",
    path: "/api/users/[id]/reactivate",
    handler: reactivate.POST,
    allowed: ADMINS,
    usesId: "user",
  },
  { method: "GET", path: "/api/leads", handler: leads.GET, allowed: LEAD_ROLES },
  { method: "POST", path: "/api/leads", handler: leads.POST, allowed: LEAD_ROLES, body: {} },
  { method: "GET", path: "/api/leads/stages", handler: leadStages.GET, allowed: LEAD_ROLES },
  { method: "GET", path: "/api/follow-ups", handler: followUps.GET, allowed: LEAD_ROLES },
  {
    method: "GET",
    path: "/api/leads/[id]",
    handler: leadItem.GET,
    allowed: LEAD_ROLES,
    usesId: "lead",
  },
  {
    method: "PATCH",
    path: "/api/leads/[id]",
    handler: leadItem.PATCH,
    allowed: LEAD_ROLES,
    usesId: "lead",
    body: {},
  },
  {
    method: "DELETE",
    path: "/api/leads/[id]",
    handler: leadItem.DELETE,
    allowed: ADMINS,
    usesId: "lead",
  },
  {
    method: "POST",
    path: "/api/leads/[id]/stage",
    handler: leadStage.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
    body: {},
  },
  {
    method: "POST",
    path: "/api/leads/[id]/notes",
    handler: leadNotes.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
    body: {},
  },
  {
    method: "POST",
    path: "/api/leads/[id]/tasks",
    handler: leadTasks.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
    body: {},
  },
  {
    method: "PATCH",
    path: "/api/leads/[id]/tasks/[taskId]",
    handler: leadTask.PATCH,
    allowed: LEAD_ROLES,
    usesId: "lead",
    body: {},
  },
  { method: "GET", path: "/api/settings", handler: settings.GET, allowed: ADMINS },
  { method: "PATCH", path: "/api/settings", handler: settings.PATCH, allowed: ADMINS, body: {} },
  { method: "GET", path: "/api/settings/stages", handler: settingStages.GET, allowed: ADMINS },
  {
    method: "POST",
    path: "/api/settings/stages",
    handler: settingStages.POST,
    allowed: ADMINS,
    body: {},
  },
  {
    method: "PATCH",
    path: "/api/settings/stages/[id]",
    handler: settingStage.PATCH,
    allowed: ADMINS,
    usesId: "stage",
    body: {},
  },
  {
    method: "DELETE",
    path: "/api/settings/stages/[id]",
    handler: settingStage.DELETE,
    allowed: ADMINS,
    usesId: "stage",
  },
  { method: "GET", path: "/api/webhooks/whatsapp", handler: whatsapp.GET, allowed: "signed" },
  {
    method: "POST",
    path: "/api/webhooks/whatsapp",
    handler: whatsapp.POST,
    allowed: "signed",
    body: {},
  },
  { method: "GET", path: "/api/conversations", handler: chats.GET, allowed: LEAD_ROLES },
  {
    method: "GET",
    path: "/api/conversations/[id]",
    handler: chatItem.GET,
    allowed: LEAD_ROLES,
    usesId: "lead",
  },
  {
    method: "POST",
    path: "/api/conversations/[id]/read",
    handler: chatRead.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
  },
  {
    method: "POST",
    path: "/api/conversations/[id]/messages",
    handler: chatMessages.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
    body: {},
  },
  {
    method: "POST",
    path: "/api/conversations/[id]/template",
    handler: chatTemplate.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
    body: {},
  },
  {
    method: "POST",
    path: "/api/conversations/[id]/media",
    handler: chatMedia.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
    body: {},
  },
  {
    method: "POST",
    path: "/api/conversations/[id]/opt-in",
    handler: chatOptIn.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
  },
  {
    method: "POST",
    path: "/api/leads/[id]/conversation",
    handler: chatStart.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
  },
  {
    method: "POST",
    path: "/api/leads/[id]/merge",
    handler: leadMerge.POST,
    allowed: MERGE_ROLES,
    usesId: "lead",
    body: {},
  },
  {
    method: "POST",
    path: "/api/messages/[id]/retry",
    handler: messageRetry.POST,
    allowed: LEAD_ROLES,
    usesId: "lead",
  },
  {
    method: "GET",
    path: "/api/messages/[id]/media",
    handler: messageMedia.GET,
    allowed: LEAD_ROLES,
    usesId: "lead",
  },
  { method: "GET", path: "/api/templates", handler: templates.GET, allowed: LEAD_ROLES },
  { method: "POST", path: "/api/templates", handler: templates.POST, allowed: ADMINS, body: {} },
  {
    method: "PATCH",
    path: "/api/templates/[id]",
    handler: templateItem.PATCH,
    allowed: ADMINS,
    usesId: "lead",
    body: {},
  },
  {
    method: "DELETE",
    path: "/api/templates/[id]",
    handler: templateItem.DELETE,
    allowed: ADMINS,
    usesId: "lead",
  },
  { method: "GET", path: "/api/teams", handler: teams.GET, allowed: TEAM_VIEW },
  { method: "POST", path: "/api/teams", handler: teams.POST, allowed: ADMINS, body: {} },
  {
    method: "GET",
    path: "/api/teams/[id]",
    handler: teamItem.GET,
    allowed: TEAM_VIEW,
    usesId: "team",
  },
  {
    method: "PATCH",
    path: "/api/teams/[id]",
    handler: teamItem.PATCH,
    allowed: ADMINS,
    usesId: "team",
    body: {},
  },
  {
    method: "DELETE",
    path: "/api/teams/[id]",
    handler: teamItem.DELETE,
    allowed: ADMINS,
    usesId: "team",
  },
  {
    method: "POST",
    path: "/api/teams/[id]/members",
    handler: teamMembers.POST,
    allowed: ADMINS,
    usesId: "team",
    body: {},
  },
  {
    method: "DELETE",
    path: "/api/teams/[id]/members/[userId]",
    handler: teamMember.DELETE,
    allowed: ADMINS,
    usesId: "team",
  },
  { method: "GET", path: "/api/roles", handler: roles.GET, allowed: SUPER_ONLY },
  { method: "POST", path: "/api/roles", handler: roles.POST, allowed: SUPER_ONLY, body: {} },
  { method: "GET", path: "/api/roles/options", handler: roleOptions.GET, allowed: ADMINS },
  {
    method: "PATCH",
    path: "/api/roles/[id]",
    handler: roleItem.PATCH,
    allowed: SUPER_ONLY,
    usesId: "role",
    body: {},
  },
  {
    method: "DELETE",
    path: "/api/roles/[id]",
    handler: roleItem.DELETE,
    allowed: SUPER_ONLY,
    usesId: "role",
  },
  {
    method: "POST",
    path: "/api/roles/[id]/reset",
    handler: roleReset.POST,
    allowed: SUPER_ONLY,
    usesId: "role",
    body: {},
  },
];

async function call(testCase: Case, headers: Record<string, string>) {
  const target = testCase.usesId ? await createTarget(testCase.usesId) : "";
  const url = new URL(
    testCase.path.replace("[id]", target).replace("[userId]", target).replace("[taskId]", target),
    origin,
  );
  const response = await (testCase.handler as Handler)(
    new Request(url, {
      method: testCase.method,
      headers: { "content-type": "application/json", ...headers },
      body: testCase.body === undefined ? undefined : JSON.stringify(testCase.body),
    }),
    { params: Promise.resolve({ id: target, userId: target, taskId: target }) as Promise<never> },
  );
  // The live-update stream never ends, so read a body only when it is the JSON envelope.
  const isStream = response.headers.get("content-type")?.includes("text/event-stream");
  const text = isStream ? "" : await response.text();
  if (isStream) await response.body?.cancel();
  return { status: response.status, text };
}

async function createTarget(kind: "user" | "team" | "role" | "lead" | "stage"): Promise<string> {
  if (kind === "stage") {
    const name = `Stage ${randomUUID()}`;
    return (await prisma.leadsPipelineStage.create({ data: { code: name, name, position: 50 } }))
      .id;
  }
  if (kind === "lead") {
    const stage = await prisma.leadsPipelineStage.findUniqueOrThrow({ where: { code: "NEW" } });
    nextPhone += 1;
    const contact = await prisma.leadsContact.create({
      data: { phoneE164: `+9197${10000000 + nextPhone}`, name: "Matrix" },
    });
    const lead = await prisma.leadsLead.create({
      data: { contactId: contact.id, stageId: stage.id },
    });
    return lead.id;
  }
  if (kind === "team") {
    return (await prisma.identityTeam.create({ data: { name: `Team ${randomUUID()}` } })).id;
  }
  if (kind === "role") {
    const code = `MATRIX_${randomUUID().replaceAll("-", "_").toUpperCase()}`;
    return (await prisma.identityRole.create({ data: { code, name: code } })).id;
  }
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

let nextPhone = 0;
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
    if (testCase.allowed === "signed") {
      expect(status).toBeLessThan(500); // the provider's signature guards it, not a session
      return;
    }
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
      if (testCase.allowed === "signed") expect(status).toBeLessThan(500);
      else if (testCase.allowed === "public") expect(status).not.toBe(401);
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
    expect(seeded.map((role) => role.code)).toEqual(expect.arrayContaining([...ROLES]));
  });
});
