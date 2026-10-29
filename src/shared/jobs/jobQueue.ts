// The queue interface modules use. The pg-boss implementation and the in-memory fake both
// implement it, so the queue technology can change without touching modules.
import type { JobDefinition } from "./defineJob";

// Methods are generic over the payload, so a job and its payload are checked together.

export interface EnqueueOptions {
  /** Idempotency key: a second job with the same key and job name is not created while the first is kept. */
  singletonKey?: string;
}

export interface JobQueue {
  /** Adds a job to run as soon as possible. Returns its ID, or null if the singleton key exists. */
  enqueue<P>(job: JobDefinition<P>, payload: P, options?: EnqueueOptions): Promise<string | null>;
  /** Adds a job that must not run before `at` (timeouts, reminders). */
  enqueueAt<P>(
    job: JobDefinition<P>,
    payload: P,
    at: Date,
    options?: EnqueueOptions,
  ): Promise<string | null>;
  /** Runs a job on a cron schedule, in the business timezone unless another is given. */
  schedule<P>(
    job: JobDefinition<P>,
    cron: string,
    payload: P,
    options?: { timezone?: string },
  ): Promise<void>;
  cancel<P>(job: JobDefinition<P>, id: string): Promise<void>;
}
