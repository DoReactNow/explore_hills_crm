// Reads for reports and dashboards. Reads only, across modules (Decision 22). Everything groups on the
// business day, never the UTC day. A soft-deleted lead (merged ones included) is never counted.
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";

export interface ReportWhere {
  start: Date;
  /** Exclusive. */
  end: Date;
  /** Null means every lead, unassigned included. */
  ownerIds: readonly string[] | null;
  source?: string;
  zone: string;
}

function leadConditions(where: ReportWhere): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`l."deletedAt" IS NULL`,
    Prisma.sql`l."createdAt" >= ${where.start}::timestamptz`,
    Prisma.sql`l."createdAt" < ${where.end}::timestamptz`,
  ];
  if (where.ownerIds) {
    parts.push(Prisma.sql`l."ownerUserId" = ANY(${[...where.ownerIds]}::uuid[])`);
  }
  if (where.source) parts.push(Prisma.sql`l.source::text = ${where.source}`);
  return Prisma.join(parts, " AND ");
}

export const reportingRepository = {
  leadsPerDay(where: ReportWhere) {
    return getPrisma().$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT to_char(l."createdAt" AT TIME ZONE ${where.zone}, 'YYYY-MM-DD') AS day, count(*) AS count
      FROM leads_leads l WHERE ${leadConditions(where)} GROUP BY 1 ORDER BY 1`;
  },

  /** Where the period's leads are now, by stage. Goes by the stage itself, so renames don't matter. */
  funnel(where: ReportWhere) {
    return getPrisma().$queryRaw<
      Array<{
        code: string;
        name: string;
        kind: string;
        position: number;
        count: bigint;
        value: Prisma.Decimal | null;
      }>
    >`
      SELECT s.code, s.name, s.kind::text AS kind, s.position, count(*) AS count, sum(l."budgetAmount") AS value
      FROM leads_leads l JOIN leads_pipeline_stages s ON s.id = l."stageId"
      WHERE ${leadConditions(where)}
      GROUP BY s.id ORDER BY s.position, s.name`;
  },

  bySource(where: ReportWhere) {
    return getPrisma().$queryRaw<Array<{ source: string; count: bigint }>>`
      SELECT l.source::text AS source, count(*) AS count
      FROM leads_leads l WHERE ${leadConditions(where)} GROUP BY 1 ORDER BY 2 DESC, 1`;
  },

  byDestination(where: ReportWhere, take: number) {
    return getPrisma().$queryRaw<Array<{ destination: string; count: bigint }>>`
      SELECT coalesce(nullif(trim(l.destination), ''), 'Not set') AS destination, count(*) AS count
      FROM leads_leads l WHERE ${leadConditions(where)} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${take}`;
  },

  responseRows(where: ReportWhere) {
    return getPrisma().$queryRaw<
      Array<{
        ownerUserId: string | null;
        createdAt: Date;
        firstResponseAt: Date | null;
        isOpen: boolean;
      }>
    >`
      SELECT l."ownerUserId", l."createdAt", l."firstResponseAt", (s.kind = 'OPEN') AS "isOpen"
      FROM leads_leads l JOIN leads_pipeline_stages s ON s.id = l."stageId"
      WHERE ${leadConditions(where)}`;
  },

  /** The agents' table: goes by each lead's current owner. */
  perAgent(where: ReportWhere) {
    return getPrisma().$queryRaw<
      Array<{
        userId: string;
        name: string;
        status: string;
        leads: bigint;
        quoted: bigint;
        won: bigint;
        value: Prisma.Decimal | null;
      }>
    >`
      SELECT u.id AS "userId", u.name, u.status::text AS status, count(*) AS leads,
        count(*) FILTER (WHERE s.code = 'QUOTED') AS quoted,
        count(*) FILTER (WHERE s.kind = 'WON') AS won,
        sum(l."budgetAmount") FILTER (WHERE s.kind = 'WON') AS value
      FROM leads_leads l
      JOIN leads_pipeline_stages s ON s.id = l."stageId"
      JOIN identity_users u ON u.id = l."ownerUserId"
      WHERE ${leadConditions(where)}
      GROUP BY u.id ORDER BY count(*) DESC, u.name`;
  },

  callsPerAgent(where: ReportWhere) {
    const owners = where.ownerIds
      ? Prisma.sql`AND c."agentUserId" = ANY(${[...where.ownerIds]}::uuid[])`
      : Prisma.empty;
    return getPrisma().$queryRaw<Array<{ userId: string; calls: bigint; talk: bigint | null }>>`
      SELECT c."agentUserId" AS "userId", count(*) AS calls, sum(c."durationSeconds") AS talk
      FROM telephony_calls c
      WHERE c."agentUserId" IS NOT NULL AND c."startedAt" >= ${where.start}::timestamptz
        AND c."startedAt" < ${where.end}::timestamptz ${owners}
      GROUP BY 1`;
  },

  callsPerDay(where: ReportWhere) {
    const owners = where.ownerIds
      ? Prisma.sql`AND c."agentUserId" = ANY(${[...where.ownerIds]}::uuid[])`
      : Prisma.empty;
    return getPrisma().$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT to_char(c."startedAt" AT TIME ZONE ${where.zone}, 'YYYY-MM-DD') AS day, count(*) AS count
      FROM telephony_calls c
      WHERE c."startedAt" >= ${where.start}::timestamptz AND c."startedAt" < ${where.end}::timestamptz ${owners}
      GROUP BY 1 ORDER BY 1`;
  },

  /** Handovers: a leaver's "back to the queue" note isn't an assignment, so it's left out. */
  assignmentsByMode(where: ReportWhere) {
    const owners = where.ownerIds
      ? Prisma.sql`AND r."toUserId" = ANY(${[...where.ownerIds]}::uuid[])`
      : Prisma.empty;
    return getPrisma().$queryRaw<Array<{ mode: string; count: bigint }>>`
      SELECT r.mode::text AS mode, count(*) AS count
      FROM assignment_records r JOIN leads_leads l ON l.id = r."leadId"
      WHERE l."deletedAt" IS NULL AND r."createdAt" >= ${where.start}::timestamptz
        AND r."createdAt" < ${where.end}::timestamptz
        AND r."fromUserId" IS DISTINCT FROM r."toUserId" ${owners}
      GROUP BY 1 ORDER BY 2 DESC, 1`;
  },

  async queueSize(): Promise<number> {
    return getPrisma().leadsLead.count({
      where: { ownerUserId: null, deletedAt: null, stage: { kind: "OPEN" } },
    });
  },

  async openLeads(ownerIds: readonly string[] | null): Promise<number> {
    return getPrisma().leadsLead.count({
      where: {
        deletedAt: null,
        stage: { kind: "OPEN" },
        ...(ownerIds ? { ownerUserId: { in: [...ownerIds] } } : {}),
      },
    });
  },

  openByAgent(ownerIds: readonly string[] | null) {
    return getPrisma().leadsLead.groupBy({
      by: ["ownerUserId"],
      where: {
        deletedAt: null,
        stage: { kind: "OPEN" },
        ownerUserId: ownerIds ? { in: [...ownerIds] } : { not: null },
      },
      _count: { _all: true },
    });
  },

  followUpsCount(ownerIds: readonly string[] | null, dueFrom: Date | null, dueTo: Date) {
    return getPrisma().leadsTask.count({
      where: {
        completedAt: null,
        dueDate: { ...(dueFrom ? { gte: dueFrom } : {}), lte: dueTo },
        lead: { deletedAt: null, closedAt: null },
        ...(ownerIds ? { assigneeUserId: { in: [...ownerIds] } } : {}),
      },
    });
  },

  nextFollowUps(ownerIds: readonly string[] | null, take: number) {
    return getPrisma().leadsTask.findMany({
      where: {
        completedAt: null,
        lead: { deletedAt: null, closedAt: null },
        ...(ownerIds ? { assigneeUserId: { in: [...ownerIds] } } : {}),
      },
      orderBy: { dueDate: "asc" },
      take,
      select: {
        id: true,
        title: true,
        dueDate: true,
        assignee: { select: { name: true } },
        lead: { select: { id: true, contact: { select: { name: true } } } },
      },
    });
  },

  longestWaiting(take: number) {
    return getPrisma().leadsLead.findMany({
      where: { ownerUserId: null, deletedAt: null, stage: { kind: "OPEN" } },
      orderBy: { createdAt: "asc" },
      take,
      select: {
        id: true,
        createdAt: true,
        destination: true,
        contact: { select: { name: true } },
      },
    });
  },

  teamMemberIds: (teamId: string) =>
    getPrisma().identityTeamMember.findMany({ where: { teamId }, select: { userId: true } }),

  listTeams: () =>
    getPrisma().identityTeam.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),

  /** A page of leads for the export, in a stable order, so a big export runs in batches. */
  exportLeads(where: ReportWhere, afterId: string | null, take: number) {
    return getPrisma().leadsLead.findMany({
      where: {
        deletedAt: null,
        createdAt: { gte: where.start, lt: where.end },
        ...(where.ownerIds ? { ownerUserId: { in: [...where.ownerIds] } } : {}),
        ...(where.source ? { source: where.source as "WHATSAPP" } : {}),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        source: true,
        destination: true,
        travellerCount: true,
        budgetAmount: true,
        createdAt: true,
        firstResponseAt: true,
        contact: { select: { name: true, phoneE164: true } },
        stage: { select: { name: true } },
        owner: { select: { name: true } },
      },
    });
  },
};
