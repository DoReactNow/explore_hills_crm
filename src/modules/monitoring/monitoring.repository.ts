// Database access for alerts and tracked errors. No rules here.
import { getPrisma } from "@/shared/db/prisma";

export const monitoringRepository = {
  /** Opens an alert, or returns null when one is already open for this code. */
  async open(code: string, detail: string, now: Date) {
    const rows = await getPrisma().$queryRaw<Array<{ id: string }>>`
      INSERT INTO monitoring_alerts (id, code, detail, "openedAt", "lastSeenAt")
      VALUES (gen_random_uuid(), ${code}, ${detail}, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (code) WHERE "resolvedAt" IS NULL DO NOTHING
      RETURNING id`;
    return rows[0] ?? null;
  },

  async touch(code: string, detail: string, now: Date) {
    await getPrisma().monitoringAlert.updateMany({
      where: { code, resolvedAt: null },
      data: { detail, lastSeenAt: now },
    });
  },

  async resolve(code: string, now: Date): Promise<number> {
    const { count } = await getPrisma().monitoringAlert.updateMany({
      where: { code, resolvedAt: null },
      data: { resolvedAt: now },
    });
    return count;
  },

  listAlerts(since: Date) {
    return getPrisma().monitoringAlert.findMany({
      where: { OR: [{ resolvedAt: null }, { openedAt: { gte: since } }] },
      orderBy: { openedAt: "desc" },
      take: 50,
    });
  },

  /** Counts one error in its hour. One statement, so several instances can't lose a count. */
  async recordError(row: {
    fingerprint: string;
    hourStart: Date;
    name: string;
    message: string;
    source: string;
    at: Date;
    requestId: string | null;
  }) {
    await getPrisma().$executeRaw`
      INSERT INTO monitoring_errors
        (id, fingerprint, "hourStart", name, message, source, count, "lastSeenAt", "lastRequestId")
      VALUES (gen_random_uuid(), ${row.fingerprint}, ${row.hourStart}::timestamptz, ${row.name},
              ${row.message}, ${row.source}, 1, ${row.at}::timestamptz, ${row.requestId})
      ON CONFLICT (fingerprint, "hourStart") DO UPDATE SET
        count = monitoring_errors.count + 1,
        "lastSeenAt" = GREATEST(monitoring_errors."lastSeenAt", EXCLUDED."lastSeenAt"),
        "lastRequestId" = COALESCE(EXCLUDED."lastRequestId", monitoring_errors."lastRequestId")`;
  },

  async countErrorsSince(since: Date): Promise<number> {
    const { _sum } = await getPrisma().monitoringError.aggregate({
      where: { hourStart: { gte: since } },
      _sum: { count: true },
    });
    return _sum.count ?? 0;
  },

  /** Grouped across hours: the most recently seen first. */
  listErrors(since: Date, limit: number) {
    return getPrisma().$queryRaw<
      Array<{
        fingerprint: string;
        name: string;
        message: string;
        source: string;
        count: number;
        lastSeenAt: Date;
        lastRequestId: string | null;
      }>
    >`
      SELECT fingerprint, max(name) AS name, max(message) AS message, max(source) AS source,
             sum(count)::int AS count, max("lastSeenAt") AS "lastSeenAt",
             (array_agg("lastRequestId" ORDER BY "lastSeenAt" DESC))[1] AS "lastRequestId"
      FROM monitoring_errors
      WHERE "hourStart" >= ${since}::timestamptz
      GROUP BY fingerprint
      ORDER BY "lastSeenAt" DESC
      LIMIT ${limit}`;
  },

  async databaseCapacity() {
    const rows = await getPrisma().$queryRaw<
      Array<{ connections: number; maxConnections: number; sizeBytes: bigint }>
    >`
      SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
             current_setting('max_connections')::int AS "maxConnections",
             pg_database_size(current_database()) AS "sizeBytes"`;
    return rows[0];
  },

  async sweep(errorsBefore: Date, alertsBefore: Date) {
    const prisma = getPrisma();
    await prisma.monitoringError.deleteMany({ where: { hourStart: { lt: errorsBefore } } });
    await prisma.monitoringAlert.deleteMany({
      where: { resolvedAt: { lt: alertsBefore } },
    });
  },
};
