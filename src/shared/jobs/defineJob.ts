// A background job definition (Decision 27): a name, a Zod-validated payload, a retry policy and a
// handler. Each module defines its jobs in <module>.jobs.ts and exports them from its index.ts;
// the worker assembles them. Handlers call the module's service, never Prisma, and are idempotent.
import type { z } from "zod";
import type { Logger } from "@/shared/logger";

export interface RetryPolicy {
  /** Retries after the first attempt (0 = no retry). */
  limit: number;
  /** Delay before a retry. */
  delaySeconds: number;
  /** Double the delay on each retry. */
  backoff: boolean;
}

export interface JobContext {
  jobId: string;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export interface JobDefinition<P = unknown> {
  name: string;
  payload: z.ZodType<P>;
  retry: RetryPolicy;
  handler: (payload: P, context: JobContext) => Promise<void>;
}

/**
 * Any job, whatever its payload type: what registries, the worker and test helpers accept.
 * (A handler for one payload type is not a handler for every payload, so JobDefinition<unknown>
 * would reject specific jobs.)
 */
export type AnyJobDefinition = Omit<JobDefinition<unknown>, "handler"> & {
  handler: (payload: never, context: JobContext) => Promise<void>;
};

const JOB_NAME = /^[a-z]+\.[a-zA-Z][a-zA-Z0-9]*$/;

export function defineJob<P>(definition: JobDefinition<P>): JobDefinition<P> {
  if (!JOB_NAME.test(definition.name)) {
    throw new Error(`Job name "${definition.name}" must look like <module>.<jobName>`);
  }
  if (!definition.payload || typeof definition.payload.safeParse !== "function") {
    throw new Error(`Job ${definition.name} needs a Zod payload schema`);
  }
  const retry = definition.retry;
  if (
    !retry ||
    !Number.isInteger(retry.limit) ||
    retry.limit < 0 ||
    !(retry.delaySeconds >= 0) ||
    typeof retry.backoff !== "boolean"
  ) {
    throw new Error(
      `Job ${definition.name} needs a retry policy ({ limit, delaySeconds, backoff })`,
    );
  }
  return Object.freeze({ ...definition });
}

/** Validates a payload against the job's schema; the error names the job, never the data. */
export function parsePayload<P>(job: { name: string; payload: z.ZodType<P> }, payload: unknown): P {
  const result = job.payload.safeParse(payload);
  if (!result.success) throw new TypeError(`Invalid payload for job ${job.name}`);
  return result.data;
}
