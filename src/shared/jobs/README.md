# Background jobs

The mechanism behind every job (Decision 27). Modules define jobs; `src/worker/` runs them; the web
app only enqueues. pg-boss is used only inside this folder (architecture rule 8).

## Defining a job

In `src/modules/<module>/<module>.jobs.ts`, exported from the module's `index.ts`:

```ts
export const responseTimeoutJob = defineJob({
  name: "assignment.responseTimeout", // <module>.<jobName>, unique
  payload: z.object({ assignmentRecordId: z.string().uuid() }), // IDs only
  retry: { limit: 5, delaySeconds: 30, backoff: true },
  handler: async ({ assignmentRecordId }, { jobId, logger }) => {
    await assignmentService.handleResponseTimeout(assignmentRecordId); // the service, never Prisma
  },
});
```

Then add it to the module's list in `src/worker/workerJobs.ts`.

## Rules for every job

1. **Idempotent.** Running the same job twice changes nothing the second time. The handler checks the
   current state (for example "is this lead still waiting for a response?") before acting.
2. **Enqueue with an idempotency key** when the same request can arrive twice:
   `queue.enqueue(job, payload, { singletonKey: recordId })`. The key becomes the job's ID, so a second
   job with the same job name and key is not created (`enqueue` returns `null`).
3. **Retry with backoff**, then fail. The last failed attempt is logged as `ALERT: job failed
permanently` with the job ID; failed jobs are kept for inspection.
4. **Timeouts are delayed jobs** (`queue.enqueueAt(job, payload, responseDueAt)`), never polling. Each
   timeout also gets a periodic **sweeper** job as a safety net, in case a delayed job was lost.
5. **Recurring jobs** use `queue.schedule(job, cron, payload)`, in the business timezone by default.
6. **Payloads are IDs and small values**, validated by the job's Zod schema before they are enqueued.
7. **Time comes from the injected `Clock`** in services. Tests never wait on real time.

## Testing

- **Unit:** call the handler directly, or use `createFakeJobQueue()` (`testing/fakeQueue.ts`) to assert
  what a service enqueued.
- **Integration:** `startTestJobRuntime()` (`testing/testRuntime.ts`) starts pg-boss on the test
  database with pg-boss's `TestClock`, which keeps JavaScript and Postgres on the same hand-moved time.
  `runPendingJobs([job])` runs every due job in-process (no worker needed); `clock.tick(ms)` moves time
  forward so delayed jobs and retries become due.
