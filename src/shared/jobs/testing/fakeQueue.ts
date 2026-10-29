// In-memory JobQueue for unit tests: records what was enqueued, scheduled and cancelled.
import { randomUUID } from "node:crypto";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { parsePayload } from "../defineJob";
import type { JobQueue } from "../jobQueue";

export interface FakeEnqueued {
  id: string | null;
  name: string;
  payload: unknown;
  singletonKey: string | null;
  startAfter: Date | null;
}

export interface FakeJobQueue extends JobQueue {
  enqueued: FakeEnqueued[];
  scheduled: Array<{ name: string; cron: string; payload: unknown; timezone: string }>;
  cancelled: Array<{ name: string; id: string }>;
}

export function createFakeJobQueue(): FakeJobQueue {
  const queue: FakeJobQueue = {
    enqueued: [],
    scheduled: [],
    cancelled: [],
    async enqueue(job, payload, options) {
      return record(job.name, parsePayload(job, payload), options?.singletonKey ?? null, null);
    },
    async enqueueAt(job, payload, at, options) {
      return record(job.name, parsePayload(job, payload), options?.singletonKey ?? null, at);
    },
    async schedule(job, cron, payload, options) {
      queue.scheduled.push({
        name: job.name,
        cron,
        payload: parsePayload(job, payload),
        timezone: options?.timezone ?? APP_CONFIG.locale.businessTimezone,
      });
    },
    async cancel(job, id) {
      queue.cancelled.push({ name: job.name, id });
    },
  };

  function record(
    name: string,
    payload: unknown,
    singletonKey: string | null,
    startAfter: Date | null,
  ) {
    if (
      singletonKey &&
      queue.enqueued.some((e) => e.name === name && e.singletonKey === singletonKey)
    ) {
      return null;
    }
    const id = randomUUID();
    queue.enqueued.push({ id, name, payload, singletonKey, startAfter });
    return id;
  }

  return queue;
}
