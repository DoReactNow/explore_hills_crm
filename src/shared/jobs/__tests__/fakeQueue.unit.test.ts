import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseInstant } from "@/shared/time";
import { defineJob } from "../defineJob";
import { createFakeJobQueue } from "../testing/fakeQueue";

const job = defineJob({
  name: "system.example",
  payload: z.object({ leadId: z.string() }),
  retry: { limit: 0, delaySeconds: 0, backoff: false },
  handler: async () => undefined,
});

describe("in-memory JobQueue fake", () => {
  it("records enqueued, delayed, scheduled and cancelled jobs", async () => {
    const queue = createFakeJobQueue();
    const now = await queue.enqueue(job, { leadId: "L1" }, { singletonKey: "k1" });
    const later = await queue.enqueueAt(
      job,
      { leadId: "L2" },
      parseInstant("2027-01-01T00:30:00Z"),
    );
    await queue.schedule(job, "0 2 * * *", { leadId: "L3" });
    await queue.cancel(job, later!);

    expect(queue.enqueued).toEqual([
      {
        id: now,
        name: "system.example",
        payload: { leadId: "L1" },
        singletonKey: "k1",
        startAfter: null,
      },
      {
        id: later,
        name: "system.example",
        payload: { leadId: "L2" },
        singletonKey: null,
        startAfter: parseInstant("2027-01-01T00:30:00Z"),
      },
    ]);
    expect(queue.scheduled).toEqual([
      {
        name: "system.example",
        cron: "0 2 * * *",
        payload: { leadId: "L3" },
        timezone: "Asia/Kolkata",
      },
    ]);
    expect(queue.cancelled).toEqual([{ name: "system.example", id: later }]);
  });

  it("ignores a second job with the same singleton key, like the real queue", async () => {
    const queue = createFakeJobQueue();
    const first = await queue.enqueue(job, { leadId: "L1" }, { singletonKey: "same" });
    const second = await queue.enqueue(job, { leadId: "L1" }, { singletonKey: "same" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(queue.enqueued).toHaveLength(1);
  });

  it("validates payloads before recording them", async () => {
    const queue = createFakeJobQueue();
    await expect(queue.enqueue(job, { leadId: 7 } as never)).rejects.toThrow(/system.example/);
    expect(queue.enqueued).toEqual([]);
  });
});
