// Prisma access to the leads module's tables. No business rules here.
import { Prisma, type LeadsTimelineKind } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";
import type { LeadSort } from "./leads.types";

export type Tx = Prisma.TransactionClient;

export const LEAD_SELECT = {
  id: true,
  source: true,
  sourceDetail: true,
  destination: true,
  travelStartDate: true,
  travelEndDate: true,
  travellerCount: true,
  budgetAmount: true,
  customFields: true,
  lastActivityAt: true,
  nextFollowUpDate: true,
  closedAt: true,
  lostReason: true,
  createdAt: true,
  updatedAt: true,
  contact: { select: { id: true, name: true, phoneE164: true, anonymisedAt: true } },
  stage: { select: { id: true, code: true, name: true, kind: true, position: true } },
  owner: { select: { id: true, name: true, status: true } },
} satisfies Prisma.LeadsLeadSelect;

export type LeadRow = Prisma.LeadsLeadGetPayload<{ select: typeof LEAD_SELECT }>;

const PERSON = { select: { id: true, name: true, status: true } } as const;

export const TASK_SELECT = {
  id: true,
  title: true,
  dueDate: true,
  completedAt: true,
  createdAt: true,
  assignee: PERSON,
} satisfies Prisma.LeadsTaskSelect;

export type TaskRow = Prisma.LeadsTaskGetPayload<{ select: typeof TASK_SELECT }>;

/** Who may be seen: every lead, or the owners listed, optionally with unassigned leads too. */
export type LeadScope =
  { kind: "all" } | { kind: "owners"; ownerIds: readonly string[]; includeUnassigned: boolean };

export function scopeWhere(scope: LeadScope): Prisma.LeadsLeadWhereInput {
  if (scope.kind === "all") return {};
  return {
    OR: [
      { ownerUserId: { in: [...scope.ownerIds] } },
      ...(scope.includeUnassigned ? [{ ownerUserId: null }] : []),
    ],
  };
}

export interface LeadListQuery {
  scope: LeadScope;
  skip: number;
  take: number;
  search?: string;
  phoneDigits?: string;
  stage?: string;
  ownerId?: string;
  unassignedOnly?: boolean;
  source?: string;
  destination?: string;
  travelFrom?: Date;
  travelTo?: Date;
  sort: LeadSort;
  direction: "asc" | "desc";
  openOnly?: boolean;
  createdBefore?: Date;
  quick?: QuickFilter;
  today: Date;
}

export type QuickFilter = "open" | "overdue" | "today" | "noFollowUp";

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

export interface NewTimelineEntry {
  leadId: string;
  kind: LeadsTimelineKind;
  summary: string;
  refType: string;
  refId: string;
  actorUserId?: string | null;
  occurredAt: Date;
}

export interface LockedLead {
  id: string;
  ownerUserId: string | null;
  destination: string | null;
  budgetAmount: Prisma.Decimal | null;
  customFields: unknown;
  createdAt: Date;
  isOpen: boolean;
}

export const leadRepository = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work);
  },

  /** Requests for one phone number queue here, so only one can see "no open lead yet". */
  async lockPhone(tx: Tx, phoneE164: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-phone:${phoneE164}`}, 0))`;
  },

  findContactByPhone(tx: Tx, phoneE164: string) {
    return tx.leadsContact.findUnique({ where: { phoneE164 } });
  },

  createContact(tx: Tx, data: { phoneE164: string; name: string | null }) {
    return tx.leadsContact.create({ data });
  },

  async restoreContact(tx: Tx, id: string): Promise<void> {
    await tx.leadsContact.update({ where: { id }, data: { deletedAt: null } });
  },

  async updateContactName(tx: Tx, id: string, name: string): Promise<void> {
    await tx.leadsContact.update({ where: { id }, data: { name } });
  },

  findOpenLeadOfContact(tx: Tx, contactId: string, exceptLeadId?: string) {
    return tx.leadsLead.findFirst({
      where: {
        contactId,
        deletedAt: null,
        stage: { kind: "OPEN" },
        ...(exceptLeadId ? { id: { not: exceptLeadId } } : {}),
      },
      select: { id: true, ownerUserId: true },
    });
  },

  async setContactOpt(
    tx: Tx,
    id: string,
    data: { optInStatus: "OPTED_IN" | "OPTED_OUT"; optInAt: Date; optInSource: string },
  ): Promise<void> {
    await tx.leadsContact.update({ where: { id }, data });
  },

  /** The first reply: records the time once. True only for the call that set it. */
  async markFirstResponse(tx: Tx, id: string, at: Date): Promise<boolean> {
    const count = await tx.$executeRaw`
      UPDATE leads_leads SET "firstResponseAt" = ${at}::timestamptz
      WHERE id = ${id}::uuid AND "firstResponseAt" IS NULL`;
    return count === 1;
  },

  /** Absorbs one lead into another. Nothing is deleted: only the parent changes. */
  async moveLeadHistory(tx: Tx, fromId: string, toId: string): Promise<void> {
    await tx.leadsNote.updateMany({ where: { leadId: fromId }, data: { leadId: toId } });
    await tx.leadsTask.updateMany({ where: { leadId: fromId }, data: { leadId: toId } });
    await tx.leadsTimelineEntry.updateMany({ where: { leadId: fromId }, data: { leadId: toId } });
  },

  findMergeTarget(tx: Tx, id: string) {
    return tx.leadsLead.findUnique({ where: { id }, select: { mergedIntoLeadId: true } });
  },

  findStage(tx: Tx, code: string) {
    return tx.leadsPipelineStage.findUnique({ where: { code } });
  },

  createLead(tx: Tx, data: Prisma.LeadsLeadUncheckedCreateInput): Promise<LeadRow> {
    return tx.leadsLead.create({ data, select: LEAD_SELECT });
  },

  /** Open leads still waiting for a first response, for the SLA sweep. */
  leadsAwaitingResponse(since: Date, take: number) {
    return getPrisma().leadsLead.findMany({
      where: {
        firstResponseAt: null,
        deletedAt: null,
        closedAt: null,
        createdAt: { gte: since },
        stage: { kind: "OPEN" },
      },
      orderBy: { createdAt: "asc" },
      take,
      select: {
        id: true,
        ownerUserId: true,
        createdAt: true,
        destination: true,
        contact: { select: { name: true } },
      },
    });
  },

  /** How many follow-ups each person has due or overdue, on open leads. */
  async followUpsDue(onOrBefore: Date) {
    const rows = await getPrisma().leadsTask.groupBy({
      by: ["assigneeUserId"],
      where: {
        completedAt: null,
        dueDate: { lte: onOrBefore },
        lead: { deletedAt: null, closedAt: null },
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({ userId: row.assigneeUserId, count: row._count._all }));
  },

  async isLeadVisible(id: string, scope: LeadScope): Promise<boolean> {
    const count = await getPrisma().leadsLead.count({
      where: { id, deletedAt: null, ...scopeWhere(scope) },
    });
    return count === 1;
  },

  /** Null when the lead is gone or out of scope; the caller answers "not found" either way. */
  findLead(tx: Tx, id: string, scope: LeadScope): Promise<LeadRow | null> {
    return tx.leadsLead.findFirst({
      where: { id, deletedAt: null, ...scopeWhere(scope) },
      select: LEAD_SELECT,
    });
  },

  /** Writes only if nobody has changed the lead since `version`. False means someone did. */
  async updateLeadIfUnchanged(
    tx: Tx,
    id: string,
    version: Date,
    data: Prisma.LeadsLeadUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const { count } = await tx.leadsLead.updateMany({
      where: { id, updatedAt: version, deletedAt: null },
      data,
    });
    return count === 1;
  },

  updateLead(tx: Tx, id: string, data: Prisma.LeadsLeadUncheckedUpdateInput): Promise<LeadRow> {
    return tx.leadsLead.update({ where: { id }, data, select: LEAD_SELECT });
  },

  /** Activity is not an edit: this leaves updatedAt alone, so nobody's open form goes stale. */
  async touchActivity(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.$executeRaw`UPDATE leads_leads SET "lastActivityAt" = ${at}::timestamptz WHERE id = ${id}::uuid`;
  },

  /** The earliest open task, or nothing once the lead is closed. Also leaves updatedAt alone. */
  async refreshNextFollowUp(tx: Tx, id: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE leads_leads l SET "nextFollowUpDate" = CASE
        WHEN l."closedAt" IS NOT NULL THEN NULL
        ELSE (SELECT min(t."dueDate") FROM leads_tasks t WHERE t."leadId" = l.id AND t."completedAt" IS NULL)
      END
      WHERE l.id = ${id}::uuid`;
  },

  async addTimeline(tx: Tx | null, entry: NewTimelineEntry): Promise<void> {
    await (tx ?? getPrisma()).leadsTimelineEntry.createMany({
      data: [entry],
      skipDuplicates: true,
    });
  },

  /** Locks the leads in id order, so two batches can't wait on each other. */
  lockLeads(tx: Tx, ids: readonly string[]) {
    return tx.$queryRaw<LockedLead[]>`
      SELECT l.id, l."ownerUserId", l.destination, l."budgetAmount", l."customFields",
             l."createdAt", (l."deletedAt" IS NULL AND s.kind = 'OPEN') AS "isOpen"
      FROM leads_leads l
      JOIN leads_pipeline_stages s ON s.id = l."stageId"
      WHERE l.id = ANY(${[...ids]}::uuid[])
      ORDER BY l.id
      FOR UPDATE OF l`;
  },

  /** Unassigned open leads in scope, oldest first. */
  findWaitingLeads(
    scope: LeadScope,
    filter: { ids?: readonly string[]; createdFrom?: Date; createdTo?: Date; take: number },
    tx?: Tx,
  ) {
    return (tx ?? getPrisma()).leadsLead.findMany({
      where: {
        ...(filter.ids ? { id: { in: [...filter.ids] } } : {}),
        ...(filter.createdFrom || filter.createdTo
          ? { createdAt: { gte: filter.createdFrom, lte: filter.createdTo } }
          : {}),
        ownerUserId: null,
        deletedAt: null,
        stage: { kind: "OPEN" },
        ...scopeWhere(scope),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: filter.take,
      select: {
        id: true,
        destination: true,
        budgetAmount: true,
        customFields: true,
        createdAt: true,
        contact: { select: { name: true } },
      },
    });
  },

  async setOwner(tx: Tx, ids: readonly string[], ownerUserId: string | null, at: Date) {
    await tx.leadsLead.updateMany({
      where: { id: { in: [...ids] } },
      data: { ownerUserId, assignedAt: ownerUserId ? at : null },
    });
  },

  /** Open follow-ups move from each earlier owner to the new one. Finished ones keep their history. */
  async moveOpenTasks(
    tx: Tx,
    moves: ReadonlyArray<{ leadId: string; fromUserId: string; toUserId: string }>,
  ): Promise<void> {
    if (moves.length === 0) return;
    await tx.$executeRaw`
      UPDATE leads_tasks t SET "assigneeUserId" = m.to_user
      FROM unnest(
        ${moves.map((move) => move.leadId)}::uuid[],
        ${moves.map((move) => move.fromUserId)}::uuid[],
        ${moves.map((move) => move.toUserId)}::uuid[]
      ) AS m(lead, from_user, to_user)
      WHERE t."leadId" = m.lead AND t."assigneeUserId" = m.from_user AND t."completedAt" IS NULL`;
  },

  /** When the owner first acted on the lead since `since`. Customers and colleagues don't count. */
  async firstOwnerAction(tx: Tx, leadId: string, userId: string, since: Date) {
    const entry = await tx.leadsTimelineEntry.findFirst({
      where: {
        leadId,
        actorUserId: userId,
        occurredAt: { gte: since },
        kind: { in: ["NOTE", "MESSAGE", "CALL", "STAGE_CHANGED", "TASK"] },
      },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    });
    return entry?.occurredAt ?? null;
  },

  async countOpenLeads(userIds: readonly string[], tx?: Tx): Promise<Map<string, number>> {
    const groups = await (tx ?? getPrisma()).leadsLead.groupBy({
      by: ["ownerUserId"],
      where: { ownerUserId: { in: [...userIds] }, deletedAt: null, stage: { kind: "OPEN" } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.ownerUserId as string, group._count._all]));
  },

  async openLeadIdsOf(tx: Tx, userId: string): Promise<string[]> {
    const rows = await tx.leadsLead.findMany({
      where: { ownerUserId: userId, deletedAt: null, stage: { kind: "OPEN" } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  async addTimelines(tx: Tx, entries: readonly NewTimelineEntry[]): Promise<void> {
    await tx.leadsTimelineEntry.createMany({ data: [...entries], skipDuplicates: true });
  },

  async listLeads(query: LeadListQuery): Promise<{
    items: LeadRow[];
    total: number;
    openCount: number;
    quickCounts: Record<QuickFilter, number>;
  }> {
    const prisma = getPrisma();
    const conditions: Prisma.Sql[] = [Prisma.sql`l."deletedAt" IS NULL`];
    if (query.scope.kind === "owners") {
      const owners = Prisma.sql`l."ownerUserId" = ANY(${[...query.scope.ownerIds]}::uuid[])`;
      conditions.push(
        query.scope.includeUnassigned ? Prisma.sql`(${owners} OR l."ownerUserId" IS NULL)` : owners,
      );
    }
    if (query.search) {
      const like = `%${escapeLike(query.search)}%`;
      conditions.push(
        query.phoneDigits
          ? Prisma.sql`(c.name ILIKE ${like} OR c."phoneE164" LIKE ${`%${query.phoneDigits}%`})`
          : Prisma.sql`c.name ILIKE ${like}`,
      );
    }
    if (query.stage) conditions.push(Prisma.sql`s.code = ${query.stage}`);
    if (query.unassignedOnly) conditions.push(Prisma.sql`l."ownerUserId" IS NULL`);
    if (query.ownerId) conditions.push(Prisma.sql`l."ownerUserId"::text = ${query.ownerId}`);
    if (query.source) conditions.push(Prisma.sql`l.source::text = ${query.source}`);
    if (query.destination) {
      conditions.push(Prisma.sql`l.destination ILIKE ${`%${escapeLike(query.destination)}%`}`);
    }
    if (query.travelFrom) {
      conditions.push(Prisma.sql`l."travelStartDate" >= ${query.travelFrom}::date`);
    }
    if (query.travelTo) conditions.push(Prisma.sql`l."travelStartDate" <= ${query.travelTo}::date`);
    if (query.openOnly) conditions.push(Prisma.sql`s.kind = 'OPEN'`);
    if (query.createdBefore) {
      conditions.push(Prisma.sql`l."createdAt" <= ${query.createdBefore}::timestamptz`);
    }
    const where = Prisma.join(conditions, " AND ");
    const quick: Record<QuickFilter, Prisma.Sql> = {
      open: Prisma.sql`s.kind = 'OPEN'`,
      overdue: Prisma.sql`s.kind = 'OPEN' AND l."nextFollowUpDate" < ${query.today}::date`,
      today: Prisma.sql`s.kind = 'OPEN' AND l."nextFollowUpDate" = ${query.today}::date`,
      noFollowUp: Prisma.sql`s.kind = 'OPEN' AND l."nextFollowUpDate" IS NULL`,
    };
    const chosen = query.quick ? quick[query.quick] : Prisma.sql`TRUE`;
    const from = Prisma.sql`FROM leads_leads l
      JOIN leads_contacts c ON c.id = l."contactId"
      JOIN leads_pipeline_stages s ON s.id = l."stageId"
      LEFT JOIN identity_users o ON o.id = l."ownerUserId"`;
    const column = {
      customer: Prisma.sql`lower(c.name)`,
      phone: Prisma.sql`c."phoneE164"`,
      destination: Prisma.sql`lower(l.destination)`,
      travelStartDate: Prisma.sql`l."travelStartDate"`,
      travellerCount: Prisma.sql`l."travellerCount"`,
      budgetAmount: Prisma.sql`l."budgetAmount"`,
      stage: Prisma.sql`s.position`,
      owner: Prisma.sql`lower(o.name)`,
      lastActivityAt: Prisma.sql`l."lastActivityAt"`,
      nextFollowUpDate: Prisma.sql`l."nextFollowUpDate"`,
      source: Prisma.sql`l.source::text`,
      createdAt: Prisma.sql`l."createdAt"`,
    }[query.sort];
    const order = Prisma.raw(query.direction === "desc" ? "DESC" : "ASC");

    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string }>>`SELECT l.id ${from} WHERE ${where} AND ${chosen}
        ORDER BY ${column} ${order} NULLS LAST, l.id ASC LIMIT ${query.take} OFFSET ${query.skip}`,
      prisma.$queryRaw<
        Array<{ total: bigint; open: bigint; overdue: bigint; today: bigint; none: bigint }>
      >`
        SELECT count(*) FILTER (WHERE ${chosen}) AS total,
          count(*) FILTER (WHERE ${quick.open}) AS open,
          count(*) FILTER (WHERE ${quick.overdue}) AS overdue,
          count(*) FILTER (WHERE ${quick.today}) AS today,
          count(*) FILTER (WHERE ${quick.noFollowUp}) AS none
        ${from} WHERE ${where}`,
    ]);
    const found = await prisma.leadsLead.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: LEAD_SELECT,
    });
    const byId = new Map(found.map((lead) => [lead.id, lead]));
    return {
      items: rows.flatMap((row) => byId.get(row.id) ?? []),
      total: Number(totals[0].total),
      openCount: Number(totals[0].open),
      quickCounts: {
        open: Number(totals[0].open),
        overdue: Number(totals[0].overdue),
        today: Number(totals[0].today),
        noFollowUp: Number(totals[0].none),
      },
    };
  },

  leadDetailParts(id: string, contactId: string, scope: LeadScope) {
    const prisma = getPrisma();
    return Promise.all([
      prisma.leadsNote.findMany({
        where: { leadId: id },
        orderBy: { createdAt: "desc" },
        select: { id: true, body: true, createdAt: true, author: PERSON },
      }),
      prisma.leadsTask.findMany({
        where: { leadId: id },
        orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueDate: "asc" }],
        select: TASK_SELECT,
      }),
      prisma.leadsTimelineEntry.findMany({
        where: { leadId: id },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 200,
        select: {
          id: true,
          kind: true,
          summary: true,
          occurredAt: true,
          actor: PERSON,
        },
      }),
      prisma.leadsLead.findMany({
        where: { contactId, id: { not: id }, deletedAt: null, ...scopeWhere(scope) },
        orderBy: { createdAt: "desc" },
        select: LEAD_SELECT,
      }),
    ]);
  },

  createNote(
    tx: Tx,
    data: { leadId: string; authorUserId: string; body: string; createdAt: Date },
  ) {
    return tx.leadsNote.create({
      data,
      select: { id: true, body: true, createdAt: true, author: PERSON },
    });
  },

  createTask(
    tx: Tx,
    data: { leadId: string; assigneeUserId: string; title: string; dueDate: Date },
  ): Promise<TaskRow> {
    return tx.leadsTask.create({ data, select: TASK_SELECT });
  },

  findTask(tx: Tx, leadId: string, id: string): Promise<TaskRow | null> {
    return tx.leadsTask.findFirst({ where: { id, leadId }, select: TASK_SELECT });
  },

  /** Sets the completion only if it actually changes. Null means there was nothing to do. */
  async setTaskCompleted(tx: Tx, id: string, at: Date | null): Promise<boolean> {
    const { count } = await tx.leadsTask.updateMany({
      where: { id, completedAt: at ? null : { not: null } },
      data: { completedAt: at },
    });
    return count === 1;
  },

  listFollowUps(
    assigneeUserId: string,
    scope: LeadScope,
    where: Prisma.LeadsTaskWhereInput,
    order: "asc" | "desc",
  ) {
    return getPrisma().leadsTask.findMany({
      where: {
        assigneeUserId,
        lead: { deletedAt: null, closedAt: null, ...scopeWhere(scope) },
        ...where,
      },
      orderBy: { dueDate: order },
      take: 200,
      select: {
        ...TASK_SELECT,
        lead: {
          select: {
            id: true,
            destination: true,
            contact: { select: { name: true } },
            stage: { select: { name: true } },
          },
        },
      },
    });
  },

  countFollowUps(assigneeUserId: string, scope: LeadScope, where: Prisma.LeadsTaskWhereInput) {
    return getPrisma().leadsTask.count({
      where: {
        assigneeUserId,
        completedAt: null,
        lead: { deletedAt: null, closedAt: null, ...scopeWhere(scope) },
        ...where,
      },
    });
  },

  listStages() {
    return getPrisma().leadsPipelineStage.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, position: true, kind: true, isActive: true },
    });
  },

  async seedStages(
    rows: ReadonlyArray<{
      code: string;
      name: string;
      position: number;
      kind: "OPEN" | "WON" | "LOST";
    }>,
  ): Promise<void> {
    await getPrisma().leadsPipelineStage.createMany({ data: [...rows], skipDuplicates: true });
  },
};

export type LeadRepository = typeof leadRepository;
