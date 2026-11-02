// P11-OBS-03: losing the database connection must not end the process. Found in the restart drill: an
// idle connection dropped by a database restart took the whole worker down.
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/shared/db/prisma";
import { closePublisher, publishEvent } from "../publish";
import { defineEventType } from "../eventTypes";
import { z } from "zod";

const probe = defineEventType({
  name: "test.publishProbe",
  payload: z.object({}),
  canReceive: () => false,
});

afterAll(closePublisher);

describe("publishEvent", () => {
  it("survives the database dropping its idle connections, and works again", async () => {
    const crashes: unknown[] = [];
    const onCrash = (error: unknown) => crashes.push(error);
    process.on("uncaughtException", onCrash);
    await publishEvent(probe, {});
    const killed = await getPrisma().$queryRaw<Array<{ pid: number }>>`
      SELECT pg_terminate_backend(pid), pid FROM pg_stat_activity
      WHERE application_name = 'explorehills-realtime-publish' AND pid <> pg_backend_pid()`;
    expect(killed.length).toBeGreaterThan(0);
    await new Promise((done) => setTimeout(done, 200));
    process.off("uncaughtException", onCrash);
    expect(crashes).toEqual([]);
    await expect(publishEvent(probe, {})).resolves.toBeUndefined();
  });
});
