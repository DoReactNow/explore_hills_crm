// W-013: the live-update stream against the real test database. Notices are sent with pg_notify on
// a separate connection, as the worker would send them.
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { systemTestEventTypes } from "@/modules/system";
import { getEnv } from "@/shared/config/env";
import type { Principal } from "@/shared/rbac/principal";
import { encodeEvent } from "@/shared/realtime/eventTypes";
import { REALTIME_CHANNEL, stopRealtimeRelay } from "@/shared/realtime/relay";
import { actAs, stopActing } from "@/tests/setup/principals";
import { GET } from "../route";

const [testPing] = systemTestEventTypes;
const worker = new Client({ connectionString: getEnv().DATABASE_URL });

beforeAll(() => worker.connect());
afterEach(() => stopActing());
afterAll(async () => {
  await worker.end();
  await stopRealtimeRelay();
});

const principal = (userId: string): Principal => ({
  userId,
  roleCode: "AGENT",
  bypassesAccess: false,
  permissions: new Set(),
});

/** Opens the stream as `who` and reads it until `pattern` appears (or fails after 5 s). */
async function openStream(who: Principal) {
  actAs(who);
  const controller = new AbortController();
  const response = await GET(
    new Request("http://127.0.0.1/api/events/stream", { signal: controller.signal }),
    {
      params: Promise.resolve({}),
    },
  );
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return {
    response,
    async waitFor(pattern: RegExp) {
      const deadline = setTimeout(() => controller.abort(), 5000);
      try {
        while (!pattern.test(text)) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
        return text;
      } finally {
        clearTimeout(deadline);
      }
    },
    close: () => controller.abort(),
  };
}

const notifyFromWorker = (targetUserId: string) =>
  worker.query("SELECT pg_notify($1, $2)", [
    REALTIME_CHANNEL,
    encodeEvent(testPing, { targetUserId }),
  ]);

describe("GET /api/events/stream", () => {
  it("answers 401 without a principal", async () => {
    actAs(null);
    const response = await GET(new Request("http://127.0.0.1/api/events/stream"), {
      params: Promise.resolve({}),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("streams a notice published through NOTIFY by another process", async () => {
    const stream = await openStream(principal("user-a"));
    try {
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get("content-type")).toMatch(/^text\/event-stream/);
      await stream.waitFor(/: connected/);

      await notifyFromWorker("user-a");

      const text = await stream.waitFor(/event: system\.testPing/);
      expect(text).toContain('event: system.testPing\ndata: {"targetUserId":"user-a"}\n\n');
    } finally {
      stream.close();
    }
  });

  it("does not deliver an event to a user its filter excludes, but delivers it to the allowed user", async () => {
    const allowed = await openStream(principal("user-a"));
    const excluded = await openStream(principal("user-b"));
    try {
      await allowed.waitFor(/: connected/);
      await excluded.waitFor(/: connected/);

      await notifyFromWorker("user-a"); // only user-a may receive this one
      await notifyFromWorker("user-b"); // sent second, so it proves user-b's stream skipped the first

      const allowedText = await allowed.waitFor(/"targetUserId":"user-a"/);
      const excludedText = await excluded.waitFor(/"targetUserId":"user-b"/);
      expect(allowedText).toContain('"targetUserId":"user-a"');
      expect(excludedText).not.toContain('"targetUserId":"user-a"');
    } finally {
      allowed.close();
      excluded.close();
    }
  });
});
