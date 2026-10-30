// Runs one attempt of a job: validates the payload, calls the handler, logs the outcome.
// A failure on the last allowed attempt is logged as an alert (Decision 27).
import { parsePayload, type AnyJobDefinition, type JobContext } from "./defineJob";

export interface JobAttempt {
  id: string;
  data: unknown;
  retryCount: number;
  retryLimit: number;
}

export async function executeJob(
  job: AnyJobDefinition,
  attempt: JobAttempt,
  logger: JobContext["logger"],
): Promise<void> {
  const fields = { jobId: attempt.id, job: job.name, attempt: attempt.retryCount + 1 };
  try {
    const payload = parsePayload(job, attempt.data);
    await job.handler(payload as never, {
      jobId: attempt.id,
      isFinalAttempt: attempt.retryCount >= attempt.retryLimit,
      logger,
    });
    logger.info("job completed", fields);
  } catch (error) {
    if (attempt.retryCount >= attempt.retryLimit) {
      logger.error("ALERT: job failed permanently", { ...fields, err: error });
    } else {
      logger.warn("job failed, will retry", { ...fields, err: error });
    }
    throw error;
  }
}
