// Database access for rate limits. No rules here.
import { getPrisma } from "@/shared/db/prisma";

export const rateLimitRepository = {
  /** Counts one hit in a fixed window, and returns the count. One statement, so it is safe at once. */
  async hit(key: string, now: Date, windowSeconds: number): Promise<number> {
    const rows = await getPrisma().$queryRaw<Array<{ count: number }>>`
      INSERT INTO system_rate_limits AS t (key, "windowStart", count)
      VALUES (${key}, ${now}::timestamptz, 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN t."windowStart" + make_interval(secs => ${windowSeconds}::int) <= ${now}::timestamptz
                     THEN 1 ELSE t.count + 1 END,
        "windowStart" = CASE WHEN t."windowStart" + make_interval(secs => ${windowSeconds}::int) <= ${now}::timestamptz
                             THEN ${now}::timestamptz ELSE t."windowStart" END
      RETURNING count`;
    return rows[0].count;
  },

  async deleteBefore(cutoff: Date): Promise<number> {
    const { count } = await getPrisma().systemRateLimit.deleteMany({
      where: { windowStart: { lt: cutoff } },
    });
    return count;
  },
};
