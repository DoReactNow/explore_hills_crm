// Read-only figures from pg-boss's own tables, for monitoring (Decision 67). pg-boss's schema belongs to
// this folder, so its tables are read nowhere else.
import { getPrisma } from "@/shared/db/prisma";

export interface QueueHealth {
  name: string;
  waiting: number;
  active: number;
  failed: number;
}

export interface JobHealth {
  /** Jobs that used up their retries since the given moment, by queue. */
  failed: Array<{ name: string; count: number }>;
  /** Jobs running past their limit, or due for longer than the patience given, by queue. */
  stuck: Array<{ name: string; count: number }>;
  queues: QueueHealth[];
}

export async function readJobHealth(
  now: Date,
  {
    failedSince,
    stuckGraceSeconds,
    waitingSince,
  }: { failedSince: Date; stuckGraceSeconds: number; waitingSince: Date },
): Promise<JobHealth> {
  const prisma = getPrisma();
  const [failed, stuck, queues] = await Promise.all([
    prisma.$queryRaw<Array<{ name: string; count: number }>>`
      SELECT name, count(*)::int AS count FROM pgboss.job
      WHERE state = 'failed' AND completed_on >= ${failedSince}::timestamptz
      GROUP BY name ORDER BY name`,
    prisma.$queryRaw<Array<{ name: string; count: number }>>`
      SELECT name, count(*)::int AS count FROM pgboss.job
      WHERE (state = 'active'
             AND started_on + make_interval(secs => expire_seconds + ${stuckGraceSeconds}::int) < ${now}::timestamptz)
         OR (state IN ('created', 'retry') AND start_after < ${waitingSince}::timestamptz)
      GROUP BY name ORDER BY name`,
    prisma.$queryRaw<QueueHealth[]>`
      SELECT name,
             count(*) FILTER (WHERE state IN ('created', 'retry'))::int AS waiting,
             count(*) FILTER (WHERE state = 'active')::int AS active,
             count(*) FILTER (WHERE state = 'failed' AND completed_on >= ${failedSince}::timestamptz)::int AS failed
      FROM pgboss.job
      GROUP BY name
      HAVING count(*) FILTER (WHERE state IN ('created', 'retry', 'active')) > 0
          OR count(*) FILTER (WHERE state = 'failed' AND completed_on >= ${failedSince}::timestamptz) > 0
      ORDER BY name`,
  ]);
  return { failed, stuck, queues };
}
