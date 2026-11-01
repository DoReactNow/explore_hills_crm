// P11-SEC-03, -04, -05: uploads and downloads can't reach other files or run in the browser, and no
// answer carries a secret.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as chatMedia from "@/app/api/conversations/[id]/media/route";
import * as diagnostics from "@/app/api/diagnostics/route";
import * as me from "@/app/api/auth/me/route";
import * as messageMedia from "@/app/api/messages/[id]/media/route";
import * as settings from "@/app/api/settings/route";
import * as softphone from "@/app/api/telephony/softphone/route";
import * as users from "@/app/api/users/route";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { getFileStorage } from "@/shared/storage";
import { assertStorageKey } from "@/shared/storage/keys";
import { systemClock } from "@/shared/time";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";

const prisma = getPrisma();
type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;
let chat: string;
let agent: string;

const upload = (file: File, clientRef: string = randomUUID()) => {
  const form = new FormData();
  form.set("file", file);
  form.set("clientRef", clientRef);
  return (chatMedia.POST as Handler)(
    new Request("http://127.0.0.1/x", { method: "POST", body: form }),
    { params: Promise.resolve({ id: chat }) as never },
  );
};
const open = (id: string) =>
  (messageMedia.GET as Handler)(new Request("http://127.0.0.1/x"), {
    params: Promise.resolve({ id }) as never,
  });
const fileMessage = async (data: {
  mediaRef: string;
  mediaMimeType?: string;
  mediaFilename?: string;
}) =>
  (
    await prisma.messagingMessage.create({
      data: {
        conversationId: chat,
        direction: "INBOUND",
        type: "DOCUMENT",
        status: "RECEIVED",
        mediaStatus: "STORED",
        occurredAt: systemClock.now(),
        ...data,
      },
    })
  ).id;

beforeAll(async () => {
  await resetDatabase();
  await syncRbac();
  await ensureDefaultStages();
  const role = await prisma.identityRole.findUniqueOrThrow({ where: { code: "AGENT" } });
  agent = (
    await prisma.identityUser.create({
      data: { email: `${randomUUID()}@example.com`, name: "A", passwordHash: "h", roleId: role.id },
    })
  ).id;
  const stage = await prisma.leadsPipelineStage.findFirstOrThrow({ where: { code: "NEW" } });
  const contact = await prisma.leadsContact.create({
    data: { phoneE164: "+919812340009", name: "C" },
  });
  const lead = await prisma.leadsLead.create({
    data: { contactId: contact.id, stageId: stage.id, ownerUserId: agent },
  });
  chat = (
    await prisma.messagingConversation.create({
      data: {
        businessPhoneNumberId: "biz",
        waId: "919812340009",
        contactId: contact.id,
        leadId: lead.id,
        lastInboundAt: systemClock.now(),
      },
    })
  ).id;
  actAs(await testPrincipal("AGENT", agent));
});
afterAll(stopActing);

describe("uploads (P11-SEC-04)", () => {
  it.each([
    ["a web page", "text/html", "page.html"],
    ["a vector image, which can hold scripts", "image/svg+xml", "logo.svg"],
    ["a script", "application/javascript", "run.js"],
    ["a program", "application/x-msdownload", "setup.exe"],
    ["an unnamed type", "", "mystery"],
  ])("refuses %s", async (_name, type, name) => {
    const response = await upload(new File(["<script>1</script>"], name, { type }));
    expect(response.status).toBe(400);
  });

  it("stores under our own key, whatever the file claims to be called", async () => {
    const response = await upload(
      new File(["photo"], "../../../../etc/passwd.jpg", { type: "image/jpeg" }),
    );
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { id: string } };
    const row = await prisma.messagingMessage.findUniqueOrThrow({ where: { id: data.id } });
    expect(row.mediaRef).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
  });
});

describe("downloads (P11-SEC-03, -04)", () => {
  it("never lets a stored key leave the storage folder", async () => {
    for (const key of ["../../.env", "/etc/passwd", "uploads/../../.env", "uploads/%2e%2e/x"]) {
      expect(() => assertStorageKey(key), key).toThrow();
      const response = await open(await fileMessage({ mediaRef: key }));
      expect(response.status, key).toBeGreaterThanOrEqual(400);
      expect(await response.text(), key).not.toContain("AUTH_SECRET");
    }
  });

  it("always downloads, sniff-proof, as a type from the allowed list", async () => {
    const key = `uploads/2026/11/${randomUUID()}.bin`;
    await getFileStorage().put(key, new TextEncoder().encode("<script>1</script>"), "text/html");
    const response = await open(
      await fileMessage({ mediaRef: key, mediaMimeType: "text/html", mediaFilename: "x.html" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await response.text();
  });

  it("can't have headers written through a file name", async () => {
    const key = `uploads/2026/11/${randomUUID()}.jpg`;
    await getFileStorage().put(key, new TextEncoder().encode("x"), "image/jpeg");
    const response = await open(
      await fileMessage({
        mediaRef: key,
        mediaMimeType: "image/jpeg",
        mediaFilename: 'a"; filename="evil.html\r\nX-Evil: 1',
      }),
    );
    expect(response.headers.get("x-evil")).toBeNull();
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="a__ filename__evil.html__X-Evil_ 1"',
    );
    await response.text();
  });
});

describe("answers hold no secrets (P11-SEC-05)", () => {
  const FORBIDDEN = /passwordHash|Encrypted|apiKey|secret/i;

  it.each([
    ["the signed-in user", me.GET],
    ["the people list", users.GET],
    ["settings", settings.GET],
    ["diagnostics", diagnostics.GET],
    ["the softphone setup", softphone.GET],
  ])("%s", async (_name, handler) => {
    actAs(await testPrincipal("SUPER_ADMIN", agent));
    const result = await callRoute(handler as Handler, { path: "/x" });
    const text = JSON.stringify(result.body);
    const env = getEnv();
    expect(text).not.toMatch(FORBIDDEN);
    for (const value of [env.AUTH_SECRET, env.CREDENTIALS_ENCRYPTION_KEY, env.DATABASE_URL]) {
      expect(text).not.toContain(value);
    }
    actAs(await testPrincipal("AGENT", agent));
  });
});

describe("source scan (P11-SEC-03)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return name === "generated" || name === "__tests__" || name === "tests" ? [] : files(path);
      }
      return /\.tsx?$/.test(name) ? [path] : [];
    });

  it("has nothing that writes raw HTML or runs text as code", () => {
    const banned =
      /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write|\beval\(|new Function\(/;
    expect(files("src").filter((file) => banned.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("sends email as plain text only", () => {
    const channel = readFileSync("src/modules/notifications/channels/types.ts", "utf8");
    expect(channel).toContain("text: string");
    expect(channel).not.toContain("html");
  });
});
