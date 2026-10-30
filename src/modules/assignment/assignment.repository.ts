// Prisma access to the assignment module's tables. No business rules here.
import { Prisma, type AssignmentMode } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";

export type Tx = Prisma.TransactionClient;

const LONG_TRANSACTION = { timeout: 60_000, maxWait: 15_000 };

export const assignmentRepository = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work, LONG_TRANSACTION);
  },

  /** Requests for the same thing queue here. Agents are always locked before their leads. */
  async lock(tx: Tx, keys: readonly string[]): Promise<void> {
    for (const key of [...new Set(keys)].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${key}`}, 0))`;
    }
  },

  findSettings(userIds: readonly string[], tx?: Tx) {
    return (tx ?? getPrisma()).assignmentAgentSetting.findMany({
      where: { userId: { in: [...userIds] } },
      include: { shifts: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] } },
    });
  },

  async lastAssignedAt(userIds: readonly string[], tx?: Tx) {
    const groups = await (tx ?? getPrisma()).assignmentRecord.groupBy({
      by: ["toUserId"],
      where: { toUserId: { in: [...userIds] } },
      _max: { createdAt: true },
    });
    return new Map(groups.map((group) => [group.toUserId, group._max.createdAt]));
  },

  async saveSettings(
    tx: Tx,
    userId: string,
    data: Omit<Prisma.AssignmentAgentSettingUncheckedCreateInput, "userId" | "shifts">,
    shifts: ReadonlyArray<{ weekday: number; startMinute: number; endMinute: number }>,
  ) {
    const setting = await tx.assignmentAgentSetting.upsert({
      where: { userId },
      create: { ...data, userId },
      update: data,
    });
    await tx.assignmentShift.deleteMany({ where: { settingId: setting.id } });
    await tx.assignmentShift.createMany({
      data: shifts.map((shift) => ({ ...shift, settingId: setting.id })),
      skipDuplicates: true,
    });
  },

  findBatch(tx: Tx, idempotencyKey: string) {
    return tx.assignmentBatch.findUnique({ where: { idempotencyKey } });
  },

  findBatchWithRecords(tx: Tx, id: string) {
    return tx.assignmentBatch.findUnique({ where: { id }, include: { records: true } });
  },

  createBatch(tx: Tx, data: Prisma.AssignmentBatchUncheckedCreateInput) {
    return tx.assignmentBatch.create({ data });
  },

  async updateBatchConfig(tx: Tx, id: string, leadCount: number, config: Prisma.InputJsonValue) {
    await tx.assignmentBatch.update({ where: { id }, data: { leadCount, config } });
  },

  async createRecords(tx: Tx, data: Prisma.AssignmentRecordCreateManyInput[]) {
    await tx.assignmentRecord.createMany({ data });
  },

  /** Stops any timer still running on these leads. */
  async cancelTimers(tx: Tx, leadIds: readonly string[]) {
    await tx.assignmentRecord.updateMany({
      where: {
        leadId: { in: [...leadIds] },
        responseDueAt: { not: null },
        respondedAt: null,
        timedOutAt: null,
      },
      data: { responseDueAt: null },
    });
  },

  earlierOwners(tx: Tx, leadIds: readonly string[]) {
    return tx.assignmentRecord.findMany({
      where: { leadId: { in: [...leadIds] } },
      distinct: ["leadId", "toUserId"],
      select: { leadId: true, toUserId: true },
    });
  },

  async clearEscalations(tx: Tx, leadIds: readonly string[]) {
    await tx.assignmentEscalation.deleteMany({ where: { leadId: { in: [...leadIds] } } });
  },

  async escalate(tx: Tx, leadId: string, timeouts: number, at: Date) {
    await tx.assignmentEscalation.upsert({
      where: { leadId },
      create: { leadId, timeouts, escalatedAt: at },
      update: { timeouts, escalatedAt: at },
    });
  },

  findRecord(tx: Tx, id: string) {
    return tx.assignmentRecord.findUnique({ where: { id } });
  },

  async setRecord(tx: Tx, id: string, data: Prisma.AssignmentRecordUncheckedUpdateInput) {
    await tx.assignmentRecord.update({ where: { id }, data });
  },

  recentRecords(tx: Tx, leadId: string) {
    return tx.assignmentRecord.findMany({
      where: { leadId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { respondedAt: true, timedOutAt: true },
    });
  },

  async dueRecordIds(now: Date, take: number): Promise<string[]> {
    const rows = await getPrisma().assignmentRecord.findMany({
      where: { responseDueAt: { lte: now }, respondedAt: null, timedOutAt: null },
      orderBy: { responseDueAt: "asc" },
      take,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  // Pool

  findOpenEntries(tx: Tx, leadIds: readonly string[]) {
    return tx.assignmentPoolEntry.findMany({
      where: { leadId: { in: [...leadIds] }, status: "OPEN" },
      select: { id: true, leadId: true },
    });
  },

  async createEntry(
    tx: Tx,
    data: { leadId: string; batchId: string; expiresAt: Date; userIds: readonly string[] },
  ) {
    const { userIds, ...fields } = data;
    return tx.assignmentPoolEntry.create({
      data: { ...fields, eligibleUsers: { create: userIds.map((userId) => ({ userId })) } },
      select: { id: true, expiresAt: true },
    });
  },

  async closeOpenEntries(tx: Tx, where: Prisma.AssignmentPoolEntryWhereInput) {
    const { count } = await tx.assignmentPoolEntry.updateMany({
      where: { ...where, status: "OPEN" },
      data: { status: "CANCELLED" },
    });
    return count;
  },

  findEntryFor(id: string, userId: string, tx?: Tx) {
    return (tx ?? getPrisma()).assignmentPoolEntry.findFirst({
      where: { id, eligibleUsers: { some: { userId } }, lead: { deletedAt: null } },
    });
  },

  findEntry(tx: Tx, id: string) {
    return tx.assignmentPoolEntry.findUnique({ where: { id } });
  },

  /** The whole claim: only one caller can move an open, unexpired entry to CLAIMED. */
  async markClaimed(tx: Tx, id: string, userId: string, now: Date): Promise<boolean> {
    const { count } = await tx.assignmentPoolEntry.updateMany({
      where: { id, status: "OPEN", expiresAt: { gt: now } },
      data: { status: "CLAIMED", claimedByUserId: userId, claimedAt: now },
    });
    return count === 1;
  },

  async markExpired(tx: Tx, id: string, now: Date): Promise<boolean> {
    const { count } = await tx.assignmentPoolEntry.updateMany({
      where: { id, status: "OPEN", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });
    return count === 1;
  },

  async dueEntryIds(now: Date, take: number): Promise<string[]> {
    const rows = await getPrisma().assignmentPoolEntry.findMany({
      where: { status: "OPEN", expiresAt: { lte: now } },
      orderBy: { expiresAt: "asc" },
      take,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  listOffers(userId: string, now: Date) {
    return getPrisma().assignmentPoolEntry.findMany({
      where: {
        status: "OPEN",
        expiresAt: { gt: now },
        eligibleUsers: { some: { userId } },
        lead: { deletedAt: null, ownerUserId: null },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        expiresAt: true,
        createdAt: true,
        lead: {
          select: {
            id: true,
            source: true,
            destination: true,
            travelStartDate: true,
            travellerCount: true,
            budgetAmount: true,
            contact: { select: { name: true } },
          },
        },
      },
    });
  },

  async queueMarks(leadIds: readonly string[], now: Date) {
    const prisma = getPrisma();
    const [entries, escalations] = await Promise.all([
      prisma.assignmentPoolEntry.findMany({
        where: { leadId: { in: [...leadIds] }, status: "OPEN", expiresAt: { gt: now } },
        select: { id: true, leadId: true, expiresAt: true },
      }),
      prisma.assignmentEscalation.findMany({
        where: { leadId: { in: [...leadIds] } },
        select: { leadId: true },
      }),
    ]);
    return {
      entries: new Map(entries.map((entry) => [entry.leadId, entry])),
      escalated: new Set(escalations.map((row) => row.leadId)),
    };
  },

  async openPoolLeadIds(): Promise<Set<string>> {
    const rows = await getPrisma().assignmentPoolEntry.findMany({
      where: { status: "OPEN" },
      select: { leadId: true },
    });
    return new Set(rows.map((row) => row.leadId));
  },

  async withoutRecords(tx: Tx, leadIds: readonly string[]): Promise<Set<string>> {
    const rows = await tx.assignmentRecord.findMany({
      where: { leadId: { in: [...leadIds] } },
      distinct: ["leadId"],
      select: { leadId: true },
    });
    const seen = new Set(rows.map((row) => row.leadId));
    return new Set(leadIds.filter((id) => !seen.has(id)));
  },

  // Rules

  findAutoRule(tx?: Tx) {
    return (tx ?? getPrisma()).assignmentRule.findFirst({
      where: { isAutoAssign: true },
      orderBy: { createdAt: "asc" },
    });
  },

  findActiveAutoRule() {
    return getPrisma().assignmentRule.findFirst({ where: { isAutoAssign: true, isActive: true } });
  },

  createRule(tx: Tx, data: Prisma.AssignmentRuleUncheckedCreateInput) {
    return tx.assignmentRule.create({ data });
  },

  updateRule(
    tx: Tx,
    id: string,
    data: {
      mode?: AssignmentMode;
      config?: Prisma.InputJsonValue;
      isActive?: boolean;
      autoAssignedUntil?: Date;
    },
  ) {
    return tx.assignmentRule.update({ where: { id }, data });
  },
};
