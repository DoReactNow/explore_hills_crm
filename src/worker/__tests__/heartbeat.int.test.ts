// W-012: the worker's heartbeat, and the worker status on GET /api/diagnostics.
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/diagnostics/route";
import { syncRbac } from "@/modules/identity";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { startHeartbeat } from "../heartbeat";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(async () => {
  await client.connect();
  await resetDatabase();
  await syncRbac();
  actAs(await testPrincipal("ADMIN"));
});
// Each test starts with no heartbeat, so the tests pass in any order.
beforeEach(() => client.query("TRUNCATE system_worker_heartbeats"));
afterAll(async () => {
  stopActing();
  await resetDatabase();
  await client.end();
  await getPrisma().$disconnect();
});

const diagnostics = async () =>
  (await callRoute<{ data: { worker: { state: string } } }>(GET, { path: "/api/diagnostics" }))
    .body!.data;

describe("worker heartbeat", () => {
  it("reports the worker down before any heartbeat", async () => {
    expect((await diagnostics()).worker).toEqual({ state: "down", lastBeatAt: null });
  });

  it("writes a heartbeat at start, and diagnostics then reports the worker up", async () => {
    const heartbeat = await startHeartbeat({ workerId: "test-host:1", intervalMs: 60_000 });
    try {
      const { rows } = await client.query(
        `SELECT "workerId", version FROM system_worker_heartbeats`,
      );
      expect(rows).toEqual([{ workerId: "test-host:1", version: expect.any(String) }]);
      expect((await diagnostics()).worker).toMatchObject({ state: "up" });
    } finally {
      heartbeat.stop();
    }
  });

  it("reports the worker down when the last heartbeat is too old", async () => {
    const heartbeat = await startHeartbeat({ workerId: "test-host:2", intervalMs: 60_000 });
    heartbeat.stop();
    await client.query(
      `UPDATE system_worker_heartbeats SET "lastBeatAt" = now() - interval '10 minutes'`,
    );
    expect((await diagnostics()).worker).toMatchObject({ state: "down" });
  });
});
