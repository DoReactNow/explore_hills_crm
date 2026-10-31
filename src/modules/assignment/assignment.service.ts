// Assignment rules (Decision 59): the queue, preview and confirm, blast, response timeouts,
// reassigning and handing over a leaver's leads. Every change of owner goes through `applyRows`, so
// each one gets the same history, follow-up moves and timer. Agents are locked before leads.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { recordAudit, type AuditAction, type AuditInput } from "@/modules/audit";
import {
  getVisibleAgentIds,
  listAssignableUsers,
  listHolders,
  listManagersAbove,
  toUserView,
  userService,
} from "@/modules/identity";
import {
  addLeadTimeline,
  addLeadTimelines,
  countOpenLeads,
  findLeadForChat,
  findWaitingLeads,
  firstOwnerAction,
  inScope,
  languageOfLead,
  leadScopeOf,
  leadService,
  lockLeads,
  moveOpenTasks,
  openLeadIdsOf,
  setLeadOwner,
  type LeadScope,
  type LockedLead,
} from "@/modules/leads";
import { latestCustomerMessages } from "@/modules/messaging";
import { notify } from "@/modules/notifications";
import { getSetting } from "@/modules/system";
import { AppError } from "@/shared/errors";
import { getJobQueue } from "@/shared/jobs";
import { logger } from "@/shared/logger";
import { assertCan } from "@/shared/rbac/assertCan";
import { can } from "@/shared/rbac/guard";
import type { Principal } from "@/shared/rbac/principal";
import { publishEvent } from "@/shared/realtime/publish";
import {
  businessDateToDbDate,
  dbDateToBusinessDate,
  instantFromEpochMs,
  systemClock,
  type Clock,
} from "@/shared/time";
import {
  agentBlock,
  matchesLead,
  responseDeadline,
  type AgentBlock,
  type AgentProfile,
} from "./assignment.eligibility";
import { leadOwnerChangedEvent, poolChangedEvent, queueChangedEvent } from "./assignment.events";
import { expiryRef, timeoutRef } from "./assignment.jobdefs";
import {
  planAssignment,
  type PlanLead,
  type PlanMode,
  type PriorityBy,
} from "./assignment.planner";
import { assignmentRepository as repository, type Tx } from "./assignment.repository";
import type {
  AgentSettingsInput,
  AutoRuleInput,
  CommitInput,
  DeactivateChoice,
  ListQueueInput,
  PreviewInput,
  ReassignInput,
} from "./assignment.schemas";
import { MAX_BATCH, UNDO_SECONDS, type AutoMode } from "./assignment.types";

export interface AssignmentContext {
  principal: Principal;
  requestId?: string;
}

type RecordMode = PlanMode | "BLAST";

const MODE_LABELS: Record<RecordMode, string> = {
  MANUAL: "Chosen by hand",
  ROUND_ROBIN: "Round-robin",
  LEAST_LOADED: "Least busy",
  PRIORITY: "By priority",
  RANDOM: "Random",
  BLAST: "Accepted from the blast pool",
};
const AUTO_RULE_NAME = "Auto-assign";
/** A lead committed just before the sweep's clock reading must still get its turn. */
const AUTO_OVERLAP_MS = 10_000;
const SWEEP_LIMIT = 500;

const root = (message: string, code: "CONFLICT" | "VALIDATION_FAILED" = "CONFLICT") =>
  new AppError(code, { fieldErrors: [{ field: "_root", message }] });
const invalid = (field: string, message: string) =>
  new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message }] });
const chooseSomeoneElse = () => invalid("toUserId", "Please choose an active agent you manage.");
const alreadyTaken = () => root("This lead was already taken by someone else.");
const offerEnded = () => root("This offer has ended.");

const BLOCK_MESSAGES: Record<AgentBlock, string> = {
  unavailable: "You're marked as unavailable, so you can't take leads right now.",
  on_leave: "You're on leave, so you can't take leads right now.",
  off_shift: "You're off shift, so you can't take leads right now.",
  at_cap: "You're at your open-lead limit. Close or hand over a lead first.",
};

const budgetOf = (value: { toString(): string } | null) =>
  value ? Number(value.toString()) : null;

const toPlanLead = (lead: {
  id: string;
  destination: string | null;
  budgetAmount: { toString(): string } | null;
  customFields: unknown;
  createdAt: Date;
}): PlanLead => ({
  id: lead.id,
  destination: lead.destination,
  language: languageOfLead(lead.customFields),
  budget: budgetOf(lead.budgetAmount),
  createdAt: lead.createdAt,
});

interface AppliedRecord {
  id: string;
  leadId: string;
  fromUserId: string | null;
  toUserId: string;
  dueAt: Date;
}
interface AfterCommit {
  timers: AppliedRecord[];
  offers: Array<{ id: string; expiresAt: Date; userIds: readonly string[] }>;
  owners: Array<{ leadId: string; userIds: string[] }>;
  poolChanged?: boolean;
}

interface Deps {
  clock?: Clock;
  /** Off in tests that drive the clock by hand: no delayed jobs, no live notices. */
  enqueue?: boolean;
  beforeCommitForTests?: () => void;
}

/** The managers above someone, or if they have none, whoever can see every lead. */
async function managersFor(userId: string): Promise<string[]> {
  const above = await listManagersAbove(userId);
  if (above.length > 0) return above;
  return (await listHolders("leads:view-all")).map((person) => person.id);
}

export function createAssignmentService({
  clock = systemClock,
  enqueue = true,
  beforeCommitForTests,
}: Deps = {}) {
  const timeoutMinutes = async () => (await getSetting("assignment.timeoutMinutes")) as number;
  const defaultCap = async () => (await getSetting("assignment.defaultOpenLeadCap")) as number;

  /** After the transaction: the timers, and the notices. A lost timer is caught by the sweep. */
  async function afterCommit({ timers, offers, owners, poolChanged }: AfterCommit) {
    if (!enqueue) return;
    for (const record of timers) {
      await notify({
        userIds: [record.toUserId],
        kind: record.fromUserId ? "lead_reassigned" : "lead_assigned",
        key: `assigned:${record.id}`,
        body: record.fromUserId
          ? "A lead has moved to you."
          : "A new lead is yours. Please reply soon.",
        link: `/leads/${record.leadId}`,
      });
      if (record.fromUserId) {
        await notify({
          userIds: [record.fromUserId],
          kind: "lead_reassigned",
          key: `moved-away:${record.id}`,
          body: "A lead has moved from you to someone else.",
        });
      }
    }
    for (const offer of offers) {
      await notify({
        userIds: offer.userIds,
        kind: "blast_offer",
        key: `offer:${offer.id}`,
        body: "First to accept gets the lead.",
        link: "/blast",
      });
    }
    const warn = (what: string) => (error: unknown) =>
      logger.warn(`could not ${what}`, { err: error });
    const queue = await getJobQueue();
    await Promise.all([
      ...timers.map((record) =>
        queue
          .enqueueAt(timeoutRef, { recordId: record.id }, record.dueAt, { singletonKey: record.id })
          .catch(warn("schedule a response timeout")),
      ),
      ...offers.map((offer) =>
        queue
          .enqueueAt(expiryRef, { entryId: offer.id }, offer.expiresAt, { singletonKey: offer.id })
          .catch(warn("schedule a pool expiry")),
      ),
      publishEvent(queueChangedEvent, {}).catch(warn("publish a queue notice")),
      ...(poolChanged || offers.length > 0
        ? [publishEvent(poolChangedEvent, {}).catch(warn("publish a pool notice"))]
        : []),
      ...owners.map((owner) =>
        publishEvent(leadOwnerChangedEvent, {
          leadId: owner.leadId,
          userIds: owner.userIds.join(","),
        }).catch(warn("publish an owner notice")),
      ),
    ]);
  }

  /** Everyone listed who can be given leads, as they are right now. */
  async function loadAgents(
    ids: readonly string[] | "all",
    cap: number,
    tx?: Tx,
  ): Promise<AgentProfile[]> {
    const users = await listAssignableUsers(ids, tx);
    const userIds = users.map((user) => user.id);
    // One at a time: these may share a transaction's single connection.
    const settings = await repository.findSettings(userIds, tx);
    const open = await countOpenLeads(userIds, tx);
    const last = await repository.lastAssignedAt(userIds, tx);
    const byUser = new Map(settings.map((row) => [row.userId, row]));
    return users.map((user) => {
      const setting = byUser.get(user.id);
      return {
        id: user.id,
        name: user.name,
        isAvailable: setting?.isAvailable ?? true,
        cap: setting?.openLeadCap ?? cap,
        tier: setting?.priorityTier ?? 0,
        languages: setting?.languages ?? [],
        destinations: setting?.destinations ?? [],
        leaveFrom: setting?.leaveFromDate ? dbDateToBusinessDate(setting.leaveFromDate) : null,
        leaveTo: setting?.leaveToDate ? dbDateToBusinessDate(setting.leaveToDate) : null,
        shifts: setting?.shifts ?? [],
        openLeads: open.get(user.id) ?? 0,
        lastAssignedAt: last.get(user.id) ?? null,
      };
    });
  }

  /**
   * Gives each lead its owner, with history, timeline, follow-ups and a timer. The leads must be
   * locked by the caller and be free to take.
   */
  async function applyRows(
    tx: Tx,
    rows: ReadonlyArray<{ leadId: string; userId: string; fromUserId?: string | null }>,
    meta: {
      mode: RecordMode;
      batchId?: string;
      actorUserId: string | null;
      reason?: string;
      minutes: number;
      agents: ReadonlyMap<string, Pick<AgentProfile, "name" | "shifts">>;
      refType: string;
    },
  ): Promise<AppliedRecord[]> {
    if (rows.length === 0) return [];
    const now = clock.now();
    const leadIds = rows.map((row) => row.leadId);

    const earlier = await repository.earlierOwners(tx, leadIds);
    await repository.cancelTimers(tx, leadIds);
    await repository.clearEscalations(tx, leadIds);
    await repository.closeOpenEntries(tx, { leadId: { in: leadIds } });

    const byUser = new Map<string, string[]>();
    for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.leadId]);
    for (const [userId, ids] of byUser) await setLeadOwner(tx, ids, userId, now);

    const dueByUser = new Map(
      [...byUser.keys()].map((userId) => [
        userId,
        responseDeadline(now, meta.minutes, meta.agents.get(userId)?.shifts ?? []),
      ]),
    );
    const applied: AppliedRecord[] = rows.map((row) => ({
      id: randomUUID(),
      leadId: row.leadId,
      fromUserId: row.fromUserId ?? null,
      toUserId: row.userId,
      dueAt: dueByUser.get(row.userId) as Date,
    }));
    await repository.createRecords(
      tx,
      applied.map((record) => ({
        id: record.id,
        batchId: meta.batchId,
        leadId: record.leadId,
        fromUserId: record.fromUserId,
        toUserId: record.toUserId,
        actorUserId: meta.actorUserId,
        mode: meta.mode,
        reason: meta.reason,
        responseDueAt: record.dueAt,
        createdAt: now,
      })),
    );

    const moves = [
      ...earlier.map((row) => ({ leadId: row.leadId, fromUserId: row.toUserId })),
      ...rows.flatMap((row) =>
        row.fromUserId ? [{ leadId: row.leadId, fromUserId: row.fromUserId }] : [],
      ),
    ].flatMap((move) => {
      const toUserId = rows.find((row) => row.leadId === move.leadId)?.userId as string;
      return move.fromUserId === toUserId ? [] : [{ ...move, toUserId }];
    });
    await moveOpenTasks(tx, moves);

    await addLeadTimelines(
      tx,
      applied.map((record) => ({
        leadId: record.leadId,
        kind: "ASSIGNED" as const,
        summary: `Assigned to ${meta.agents.get(record.toUserId)?.name ?? "an agent"} · ${MODE_LABELS[meta.mode]}`,
        refType: meta.refType,
        refId: record.id,
        actorUserId: meta.actorUserId,
        occurredAt: now,
      })),
    );
    return applied;
  }

  const audit = (
    tx: Tx,
    context: AssignmentContext | null,
    action: AuditAction,
    entityType: string,
    entityId: string,
    summary: string,
    metadata?: AuditInput["metadata"],
  ) =>
    recordAudit(tx, {
      action,
      entityType,
      entityId,
      summary,
      actor: context
        ? { userId: context.principal.userId, roleCode: context.principal.roleCode }
        : null,
      requestId: context?.requestId,
      metadata,
    });

  /** Moves a lead back to the queue: no owner and no timer. */
  async function returnToQueue(tx: Tx, leadIds: readonly string[]) {
    await setLeadOwner(tx, leadIds, null, clock.now());
    await repository.cancelTimers(tx, leadIds);
  }

  async function commitBlast(
    tx: Tx,
    context: AssignmentContext,
    batchId: string,
    scope: LeadScope,
    offers: NonNullable<CommitInput["offers"]>,
    cap: number,
    poolMinutes: number,
  ) {
    const now = clock.now();
    const allowed = offers.userIds.filter((userId) => inScope(scope, userId));
    const agents = (await loadAgents(allowed, cap, tx)).filter(
      (agent) => agentBlock(agent, now) === null,
    );
    if (agents.length === 0)
      throw root("None of those agents can take leads right now.", "VALIDATION_FAILED");

    const locked = await lockLeads(tx, offers.leadIds);
    const pooled = new Set(
      (await repository.findOpenEntries(tx, offers.leadIds)).map((entry) => entry.leadId),
    );
    const created: Array<{ id: string; expiresAt: Date; userIds: readonly string[] }> = [];
    let skippedTaken = 0;
    let leftInQueue = 0;
    for (const lead of locked) {
      if (!lead.isOpen || lead.ownerUserId || pooled.has(lead.id)) {
        skippedTaken += 1;
        continue;
      }
      const offered = agents.filter((agent) => matchesLead(agent, toPlanLead(lead)));
      if (offered.length === 0) {
        leftInQueue += 1;
        continue;
      }
      const userIds = offered.map((agent) => agent.id);
      const entry = await repository.createEntry(tx, {
        leadId: lead.id,
        batchId,
        expiresAt: instantFromEpochMs(now.getTime() + poolMinutes * 60_000),
        userIds,
      });
      created.push({ ...entry, userIds });
    }
    return {
      offers: created,
      result: {
        batchId,
        assignedCount: 0,
        pooledCount: created.length,
        skippedTaken,
        leftInQueue,
        perAgent: [] as Array<{ userId: string; name: string; count: number }>,
      },
    };
  }

  async function commitRows(
    tx: Tx,
    context: AssignmentContext,
    batchId: string,
    scope: LeadScope,
    mode: PlanMode,
    rows: NonNullable<CommitInput["rows"]>,
    cap: number,
    minutes: number,
  ) {
    const now = clock.now();
    const userIds = [...new Set(rows.map((row) => row.userId))];
    if (userIds.some((userId) => !inScope(scope, userId))) {
      throw invalid("rows", "You can only assign to people you manage.");
    }
    await repository.lock(
      tx,
      userIds.map((id) => `agent:${id}`),
    );
    const agents = new Map((await loadAgents(userIds, cap, tx)).map((agent) => [agent.id, agent]));
    const locked = new Map(
      (
        await lockLeads(
          tx,
          rows.map((row) => row.leadId),
        )
      ).map((lead) => [lead.id, lead]),
    );

    const accepted: Array<{ leadId: string; userId: string }> = [];
    const open = new Map([...agents.values()].map((agent) => [agent.id, agent.openLeads]));
    let skippedTaken = 0;
    let leftInQueue = 0;
    for (const row of rows) {
      const lead = locked.get(row.leadId);
      if (!lead?.isOpen || lead.ownerUserId) {
        skippedTaken += 1;
        continue;
      }
      const agent = agents.get(row.userId);
      const load = open.get(row.userId) ?? 0;
      if (
        !agent ||
        agentBlock({ ...agent, openLeads: load }, now) !== null ||
        !matchesLead(agent, toPlanLead(lead))
      ) {
        leftInQueue += 1;
        continue;
      }
      open.set(row.userId, load + 1);
      accepted.push(row);
    }
    const applied = await applyRows(tx, accepted, {
      mode,
      batchId,
      actorUserId: context.principal.userId,
      minutes,
      agents,
      refType: "assignment",
    });
    const perAgent = userIds.flatMap((userId) => {
      const count = accepted.filter((row) => row.userId === userId).length;
      return count > 0 ? [{ userId, name: agents.get(userId)?.name ?? "", count }] : [];
    });
    return {
      applied,
      result: {
        batchId,
        assignedCount: accepted.length,
        pooledCount: 0,
        skippedTaken,
        leftInQueue,
        perAgent,
      },
    };
  }

  /** Inside a locked transaction. Unresponsive leads go back; the rest are left as they are. */
  async function settleTimeout(
    tx: Tx,
    recordId: string,
    limit: number,
  ): Promise<{ leadId: string; escalated: boolean; previousOwner: string } | null> {
    const first = await repository.findRecord(tx, recordId);
    if (!first) return null;
    const [lead] = await lockLeads(tx, [first.leadId]);
    const record = await repository.findRecord(tx, recordId);
    if (!record?.responseDueAt || record.respondedAt || record.timedOutAt) return null;
    const now = clock.now();
    if (record.responseDueAt.getTime() > now.getTime()) return null;

    if (!lead?.isOpen || lead.ownerUserId !== record.toUserId) {
      await repository.setRecord(tx, record.id, { responseDueAt: null });
      return null;
    }
    const acted = await firstOwnerAction(tx, record.leadId, record.toUserId, record.createdAt);
    if (acted) {
      await repository.setRecord(tx, record.id, { respondedAt: acted });
      return null;
    }

    await repository.setRecord(tx, record.id, { timedOutAt: now });
    await setLeadOwner(tx, [record.leadId], null, now);
    let inARow = 0;
    for (const earlier of await repository.recentRecords(tx, record.leadId)) {
      if (earlier.respondedAt) break;
      if (earlier.timedOutAt) inARow += 1;
    }
    const escalated = inARow >= limit;
    if (escalated) await repository.escalate(tx, record.leadId, inARow, now);
    await addLeadTimeline(tx, {
      leadId: record.leadId,
      kind: "ASSIGNED",
      summary: escalated
        ? "Back in the queue for a manager: no response in time, again"
        : "Back in the queue: no response in time",
      refType: "assignment_timeout",
      refId: record.id,
      occurredAt: now,
    });
    await audit(tx, null, "assignment.timed_out", "lead", record.leadId, "Response timed out", {
      recordId: record.id,
      escalated,
    });
    return { leadId: record.leadId, escalated, previousOwner: record.toUserId };
  }

  async function runAutoAssign(minutes: number, cap: number) {
    const active = await repository.findActiveAutoRule();
    if (!active) return;
    const now = clock.now();
    const config = active.config as { priorityBy?: PriorityBy };
    const done = await repository.transaction(async (tx) => {
      await repository.lock(tx, ["auto-rule"]);
      const rule = await repository.findAutoRule(tx);
      if (!rule?.isActive) return null;
      const waiting = await findWaitingLeads(
        { kind: "all" },
        { createdFrom: rule.autoAssignedUntil ?? undefined, createdTo: now, take: MAX_BATCH },
        tx,
      );
      await repository.updateRule(tx, rule.id, {
        autoAssignedUntil: instantFromEpochMs(now.getTime() - AUTO_OVERLAP_MS),
      });
      const newOnes = await repository.withoutRecords(
        tx,
        waiting.map((lead) => lead.id),
      );
      const pooled = await repository.findOpenEntries(tx, [...newOnes]);
      const skip = new Set(pooled.map((entry) => entry.leadId));
      const leads = waiting.filter((lead) => newOnes.has(lead.id) && !skip.has(lead.id));
      if (leads.length === 0) return null;

      const everyone = await listAssignableUsers("all", tx);
      await repository.lock(
        tx,
        everyone.map((user) => `agent:${user.id}`),
      );
      const agents = await loadAgents("all", cap, tx);
      const { rows } = planAssignment({
        mode: rule.mode as AutoMode,
        leads: leads.map(toPlanLead),
        agents: agents.filter((agent) => agentBlock(agent, now) === null),
        priorityBy: config.priorityBy,
        seed: randomInt(2 ** 31),
      });
      await lockLeads(
        tx,
        rows.map((row) => row.leadId),
      );
      const batch = await repository.createBatch(tx, {
        idempotencyKey: `auto:${randomUUID()}`,
        mode: rule.mode,
        status: "COMMITTED",
        leadCount: rows.length,
        createdAt: now,
      });
      const applied = await applyRows(tx, rows, {
        mode: rule.mode as AutoMode,
        batchId: batch.id,
        actorUserId: null,
        minutes,
        agents: new Map(agents.map((agent) => [agent.id, agent])),
        refType: "assignment",
      });
      if (applied.length > 0) {
        await audit(
          tx,
          null,
          "assignment.batch_committed",
          "assignment_batch",
          batch.id,
          "New leads auto-assigned",
          { mode: rule.mode, assigned: applied.length },
        );
      }
      return applied;
    });
    if (done?.length) {
      await afterCommit({
        timers: done,
        offers: [],
        owners: done.map((record) => ({ leadId: record.leadId, userIds: [record.toUserId] })),
      });
    }
  }

  return {
    async listQueue(context: AssignmentContext, input: ListQueueInput) {
      assertCan(context.principal, "leads:assign");
      const now = clock.now();
      const sla = (await getSetting("sla.firstResponseMinutes")) as number;
      const waitingSince = instantFromEpochMs(now.getTime() - sla * 60_000);
      const base = {
        pageSize: input.pageSize,
        owner: "unassigned",
        sort: "createdAt",
        direction: "asc",
        openOnly: true,
      } as const;
      const [page, waiting] = await Promise.all([
        leadService.listLeads(context, {
          ...base,
          page: input.page,
          search: input.search,
          ...(input.filter === "waiting" ? { createdBefore: waitingSince } : {}),
          ...(input.filter === "whatsapp" ? { source: "WHATSAPP" } : {}),
        }),
        leadService.listLeads(context, {
          ...base,
          page: 1,
          pageSize: 1,
          createdBefore: waitingSince,
        }),
      ]);
      const ids = page.items.map((lead) => lead.id);
      const [marks, messages] = await Promise.all([
        repository.queueMarks(ids, now),
        latestCustomerMessages(ids),
      ]);
      return {
        total: page.total,
        waitingLong: waiting.total,
        firstResponseMinutes: sla,
        page: page.page,
        pageSize: page.pageSize,
        items: page.items.map((lead) => ({
          ...lead,
          enquiry: messages.get(lead.id) ?? null,
          poolEntryId: marks.entries.get(lead.id)?.id ?? null,
          poolExpiresAt: marks.entries.get(lead.id)?.expiresAt ?? null,
          escalated: marks.escalated.has(lead.id),
        })),
      };
    },

    async listAgents({ principal }: AssignmentContext) {
      if (
        !can(principal, "leads:assign") &&
        !can(principal, "leads:reassign") &&
        !can(principal, "assignment:manage-rules") &&
        !can(principal, "users:deactivate")
      ) {
        throw new AppError("FORBIDDEN", { logContext: { principalId: principal.userId } });
      }
      const now = clock.now();
      const cap = await defaultCap();
      // Whoever may deactivate people picks among everyone they could hand leads to.
      const visible = await getVisibleAgentIds(principal, {
        own: "leads:view-own",
        team: "leads:view-team",
        all: "leads:view-all",
      });
      const agents = await loadAgents(visible, cap);
      return {
        defaultCap: cap,
        timeoutMinutes: await timeoutMinutes(),
        poolExpiryMinutes: (await getSetting("assignment.poolExpiryMinutes")) as number,
        maxTimeouts: (await getSetting("assignment.maxTimeouts")) as number,
        items: agents.map((agent) => ({
          ...agent,
          lastAssignedAt: agent.lastAssignedAt?.toISOString() ?? null,
          room: Math.max(agent.cap - agent.openLeads, 0),
          block: agentBlock(agent, now),
        })),
      };
    },

    async updateAgentSettings(
      context: AssignmentContext,
      userId: string,
      input: AgentSettingsInput,
    ) {
      assertCan(context.principal, "assignment:manage-rules");
      const scope = await leadScopeOf(context.principal);
      const [person] = inScope(scope, userId) ? await listAssignableUsers([userId]) : [];
      if (!person) throw new AppError("NOT_FOUND");
      const { leaveFromDate: from, leaveToDate: to } = input;
      if (Boolean(from) !== Boolean(to)) {
        throw invalid("leaveToDate", "Please give both the first and last day of leave.");
      }
      if (from && to && to < from) {
        throw invalid("leaveToDate", "Leave can't end before it starts.");
      }
      await repository.transaction(async (tx) => {
        const { shifts, ...fields } = input;
        await repository.saveSettings(
          tx,
          userId,
          {
            ...fields,
            leaveFromDate: from ? businessDateToDbDate(from) : null,
            leaveToDate: to ? businessDateToDbDate(to) : null,
          },
          shifts,
        );
        await audit(
          tx,
          context,
          "assignment.settings_changed",
          "user",
          userId,
          "Assignment settings changed",
        );
      });
      return { saved: true };
    },

    async openLeadCount(context: AssignmentContext, userId: string) {
      assertCan(context.principal, "users:deactivate");
      const open = await countOpenLeads([userId]);
      return { openLeads: open.get(userId) ?? 0 };
    },

    /** Changes nothing: shows who would get what. Confirming sends this plan back. */
    async preview(context: AssignmentContext, input: PreviewInput) {
      assertCan(context.principal, "leads:assign");
      const scope = await leadScopeOf(context.principal);
      const now = clock.now();
      const cap = await defaultCap();
      const pooled = input.all ? await repository.openPoolLeadIds() : new Set<string>();
      const waiting = (
        await findWaitingLeads(scope, {
          ids: input.all ? undefined : (input.leadIds ?? []),
          take: MAX_BATCH,
        })
      ).filter((lead) => !pooled.has(lead.id));
      const allowed = input.userIds.filter((userId) => inScope(scope, userId));
      const agents = await loadAgents(allowed, cap);
      const eligible = agents.filter((agent) => agentBlock(agent, now) === null);
      const names = new Map(waiting.map((lead) => [lead.id, lead]));

      const plan =
        input.mode === "BLAST"
          ? { rows: [], unplaced: [] }
          : planAssignment({
              mode: input.mode,
              leads: waiting.map(toPlanLead),
              agents: eligible,
              priorityBy: input.priorityBy,
              seed: randomInt(2 ** 31),
            });
      return {
        leadCount: waiting.length,
        leadIds: waiting.map((lead) => lead.id),
        rows: plan.rows.map((row) => ({
          ...row,
          customer: names.get(row.leadId)?.contact.name ?? null,
          destination: names.get(row.leadId)?.destination ?? null,
        })),
        unplaced: plan.unplaced,
        agents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          openLeads: agent.openLeads,
          cap: agent.cap,
          block: agentBlock(agent, now),
          adding: plan.rows.filter((row) => row.userId === agent.id).length,
        })),
      };
    },

    async commit(context: AssignmentContext, input: CommitInput) {
      assertCan(context.principal, "leads:assign");
      const { mode, idempotencyKey, rows, offers } = input;
      if (mode === "BLAST" ? !offers : !rows?.length) {
        throw root("There's nothing to assign.", "VALIDATION_FAILED");
      }
      if (mode === "BLAST" && offers?.userIds.length === 0) {
        throw root("Please choose at least one agent to offer these to.", "VALIDATION_FAILED");
      }
      const scope = await leadScopeOf(context.principal);
      const cap = await defaultCap();
      const minutes = await timeoutMinutes();
      const poolMinutes = (await getSetting("assignment.poolExpiryMinutes")) as number;
      const hash = createHash("sha256")
        .update(JSON.stringify({ mode, rows, offers }))
        .digest("hex");

      const outcome = await repository.transaction(async (tx) => {
        await repository.lock(tx, [`key:${idempotencyKey}`]);
        const existing = await repository.findBatch(tx, idempotencyKey);
        if (existing) {
          const stored = existing.config as { hash: string; result: unknown };
          if (stored.hash !== hash) {
            throw root("This request was already used for something else. Please try again.");
          }
          return { repeat: true as const, result: stored.result };
        }

        const batch = await repository.createBatch(tx, {
          idempotencyKey,
          mode,
          requestedByUserId: context.principal.userId,
          status: "COMMITTED",
          leadCount: 0,
          createdAt: clock.now(),
        });
        const blast =
          mode === "BLAST"
            ? await commitBlast(
                tx,
                context,
                batch.id,
                scope,
                offers as NonNullable<typeof offers>,
                cap,
                poolMinutes,
              )
            : null;
        const direct =
          mode === "BLAST"
            ? null
            : await commitRows(
                tx,
                context,
                batch.id,
                scope,
                mode,
                rows as NonNullable<typeof rows>,
                cap,
                minutes,
              );
        const result = (blast?.result ?? direct?.result) as NonNullable<typeof direct>["result"];
        await repository.updateBatchConfig(
          tx,
          batch.id,
          result.assignedCount + result.pooledCount,
          { hash, result },
        );
        await audit(
          tx,
          context,
          "assignment.batch_committed",
          "assignment_batch",
          batch.id,
          "Leads assigned from the queue",
          {
            mode,
            assigned: result.assignedCount,
            pooled: result.pooledCount,
            skipped: result.skippedTaken,
            left: result.leftInQueue,
          },
        );
        beforeCommitForTests?.();
        return {
          repeat: false as const,
          result,
          timers: direct?.applied ?? [],
          offers: blast?.offers ?? [],
        };
      });
      if (outcome.repeat) return outcome.result as CommitResult;
      await afterCommit({
        timers: outcome.timers,
        offers: outcome.offers,
        owners: outcome.timers.map((record) => ({
          leadId: record.leadId,
          userIds: [record.toUserId],
        })),
      });
      return outcome.result;
    },

    /** Only just after confirming, by whoever confirmed, for leads nobody has acted on yet. */
    async undo(context: AssignmentContext, batchId: string) {
      assertCan(context.principal, "leads:assign");
      const now = clock.now();
      const outcome = await repository.transaction(async (tx) => {
        const batch = await repository.findBatchWithRecords(tx, batchId);
        if (!batch || batch.requestedByUserId !== context.principal.userId) {
          throw new AppError("NOT_FOUND");
        }
        if (now.getTime() - batch.createdAt.getTime() > UNDO_SECONDS * 1000) {
          throw root("It's too late to undo this. You can still reassign the leads.");
        }
        const locked = new Map(
          (
            await lockLeads(
              tx,
              batch.records.map((record) => record.leadId),
            )
          ).map((lead: LockedLead) => [lead.id, lead]),
        );
        const undone: string[] = [];
        for (const record of batch.records) {
          const stillTheirs = locked.get(record.leadId)?.ownerUserId === record.toUserId;
          if (
            stillTheirs &&
            !(await firstOwnerAction(tx, record.leadId, record.toUserId, record.createdAt))
          ) {
            undone.push(record.leadId);
            await addLeadTimeline(tx, {
              leadId: record.leadId,
              kind: "ASSIGNED",
              summary: "Assignment undone: back in the queue",
              refType: "assignment_undo",
              refId: record.id,
              actorUserId: context.principal.userId,
              occurredAt: now,
            });
          }
        }
        await returnToQueue(tx, undone);
        const cancelled = await repository.closeOpenEntries(tx, { batchId });
        await audit(
          tx,
          context,
          "assignment.batch_committed",
          "assignment_batch",
          batchId,
          "Assignment undone",
          {
            undone: undone.length,
            cancelled,
          },
        );
        return {
          undone: undone.length + cancelled,
          owners: batch.records
            .filter((record) => undone.includes(record.leadId))
            .map((record) => ({ leadId: record.leadId, userIds: [record.toUserId] })),
        };
      });
      await afterCommit({ timers: [], offers: [], owners: outcome.owners, poolChanged: true });
      return { undone: outcome.undone };
    },

    /** What this agent is being offered, and how much room they have. */
    async listPool({ principal }: AssignmentContext) {
      assertCan(principal, "leads:claim");
      const now = clock.now();
      const [offers, agents] = await Promise.all([
        repository.listOffers(principal.userId, now),
        loadAgents([principal.userId], await defaultCap()),
      ]);
      const me = agents[0];
      const messages = await latestCustomerMessages(offers.map((offer) => offer.lead.id));
      return {
        room: me ? Math.max(me.cap - me.openLeads, 0) : 0,
        block: me ? agentBlock(me, now) : null,
        items: offers.map((offer) => ({
          id: offer.id,
          expiresAt: offer.expiresAt,
          createdAt: offer.createdAt,
          leadId: offer.lead.id,
          customer: offer.lead.contact.name,
          source: offer.lead.source,
          destination: offer.lead.destination,
          travellerCount: offer.lead.travellerCount,
          travelStartDate: offer.lead.travelStartDate
            ? dbDateToBusinessDate(offer.lead.travelStartDate)
            : null,
          budgetAmount: offer.lead.budgetAmount?.toString() ?? null,
          message: messages.get(offer.lead.id) ?? null,
        })),
      };
    },

    /** Exactly one agent wins. The winner repeating it changes nothing. */
    async claim(context: AssignmentContext, entryId: string) {
      const { principal } = context;
      assertCan(principal, "leads:claim");
      const userId = principal.userId;
      const offered = await repository.findEntryFor(entryId, userId);
      if (!offered) throw new AppError("NOT_FOUND");
      const cap = await defaultCap();
      const minutes = await timeoutMinutes();

      const applied = await repository.transaction(async (tx) => {
        await repository.lock(tx, [`agent:${userId}`]);
        const [lead] = await lockLeads(tx, [offered.leadId]);
        const entry = await repository.findEntry(tx, entryId);
        if (!entry) throw new AppError("NOT_FOUND");
        if (entry.status === "CLAIMED") {
          if (entry.claimedByUserId === userId) return [];
          throw alreadyTaken();
        }
        const now = clock.now();
        if (entry.status !== "OPEN" || entry.expiresAt.getTime() <= now.getTime())
          throw offerEnded();
        if (lead?.ownerUserId) throw alreadyTaken();
        if (!lead?.isOpen) throw offerEnded();

        const [me] = await loadAgents([userId], cap, tx);
        if (!me) throw offerEnded();
        const block = agentBlock(me, now);
        if (block) throw root(BLOCK_MESSAGES[block]);

        if (!(await repository.markClaimed(tx, entryId, userId, now))) throw alreadyTaken();
        return applyRows(tx, [{ leadId: entry.leadId, userId }], {
          mode: "BLAST",
          batchId: entry.batchId ?? undefined,
          actorUserId: userId,
          minutes,
          agents: new Map([[userId, me]]),
          refType: "assignment",
        });
      });
      await afterCommit({
        timers: applied,
        offers: [],
        poolChanged: true,
        owners: applied.map((record) => ({ leadId: record.leadId, userIds: [userId] })),
      });
      return { leadId: offered.leadId };
    },

    async cancelPoolEntry(context: AssignmentContext, entryId: string) {
      assertCan(context.principal, "leads:assign");
      const scope = await leadScopeOf(context.principal);
      if (scope.kind === "owners" && !scope.includeUnassigned) throw new AppError("NOT_FOUND");
      const cancelled = await repository.transaction(async (tx) => {
        const entry = await repository.findEntry(tx, entryId);
        if (!entry) throw new AppError("NOT_FOUND");
        await lockLeads(tx, [entry.leadId]);
        const count = await repository.closeOpenEntries(tx, { id: entryId });
        if (count === 0) throw root("This offer has already ended.");
        await audit(
          tx,
          context,
          "assignment.pool_cancelled",
          "lead",
          entry.leadId,
          "Blast offer cancelled",
        );
        return count;
      });
      await afterCommit({ timers: [], offers: [], owners: [], poolChanged: true });
      return { cancelled };
    },

    /** A manager's override: the new owner may be off shift or over their cap, but must be an agent. */
    async reassign(context: AssignmentContext, leadId: string, input: ReassignInput) {
      assertCan(context.principal, "leads:reassign");
      const scope = await leadScopeOf(context.principal);
      const cap = await defaultCap();
      const minutes = await timeoutMinutes();
      const { toUserId, reason } = input;
      const outcome = await repository.transaction(async (tx) => {
        await repository.lock(tx, [`agent:${toUserId}`]);
        const [lead] = await lockLeads(tx, [leadId]);
        if (!lead || !(await findLeadForChat(tx, leadId, scope))) throw new AppError("NOT_FOUND");
        if (lead.ownerUserId === toUserId) return null;
        if (!lead.isOpen) throw root("A closed lead can't be reassigned. Reopen it first.");
        if (!inScope(scope, toUserId)) throw chooseSomeoneElse();
        const [agent] = await loadAgents([toUserId], cap, tx);
        if (!agent) throw chooseSomeoneElse();
        const applied = await applyRows(
          tx,
          [{ leadId, userId: toUserId, fromUserId: lead.ownerUserId }],
          {
            mode: "MANUAL",
            actorUserId: context.principal.userId,
            reason,
            minutes,
            agents: new Map([[toUserId, agent]]),
            refType: "reassignment",
          },
        );
        await audit(tx, context, "assignment.reassigned", "lead", leadId, "Lead reassigned", {
          fromUserId: lead.ownerUserId,
          toUserId,
        });
        return { applied, from: lead.ownerUserId };
      });
      if (!outcome) return { changed: false };
      await afterCommit({
        timers: outcome.applied,
        offers: [],
        poolChanged: true,
        owners: [
          {
            leadId,
            userIds: [toUserId, ...(outcome.from ? [outcome.from] : [])],
          },
        ],
      });
      return { changed: true };
    },

    /** Deactivates someone and settles their open leads in one transaction (Decision 59). */
    async deactivateUser(context: AssignmentContext, userId: string, choice: DeactivateChoice) {
      assertCan(context.principal, "users:deactivate");
      const cap = await defaultCap();
      const minutes = await timeoutMinutes();
      const scope = choice.openLeads === "agent" ? await leadScopeOf(context.principal) : null;
      const after: AfterCommit = { timers: [], offers: [], owners: [] };

      const user = await userService.deactivateUser(context, userId, async (tx) => {
        const toUserId = choice.openLeads === "agent" ? choice.toUserId : null;
        if (toUserId) {
          await repository.lock(tx, [`agent:${toUserId}`]);
          if (toUserId === userId || !inScope(scope as LeadScope, toUserId))
            throw chooseSomeoneElse();
        }
        const leadIds = await openLeadIdsOf(tx, userId);
        await lockLeads(tx, leadIds);
        if (leadIds.length > 0 || toUserId) {
          if (choice.openLeads === "keep") {
            await repository.cancelTimers(tx, leadIds);
          } else if (choice.openLeads === "queue") {
            await returnToQueue(tx, leadIds);
            // Keeps them on record as an earlier owner, so their follow-ups move at the next assignment.
            await repository.createRecords(
              tx,
              leadIds.map((leadId) => ({
                leadId,
                fromUserId: userId,
                toUserId: userId,
                actorUserId: context.principal.userId,
                mode: "MANUAL" as const,
                reason: "The owner left: back in the queue",
                createdAt: clock.now(),
              })),
            );
            await addLeadTimelines(
              tx,
              leadIds.map((leadId) => ({
                leadId,
                kind: "ASSIGNED" as const,
                summary: "Back in the queue: the owner left",
                refType: "owner_left",
                refId: `${leadId}:${userId}:${clock.now().getTime()}`,
                actorUserId: context.principal.userId,
                occurredAt: clock.now(),
              })),
            );
          } else if (toUserId) {
            const [agent] = await loadAgents([toUserId], cap, tx);
            if (!agent) throw chooseSomeoneElse();
            after.timers = await applyRows(
              tx,
              leadIds.map((leadId) => ({ leadId, userId: toUserId, fromUserId: userId })),
              {
                mode: "MANUAL",
                actorUserId: context.principal.userId,
                reason: "The previous owner left",
                minutes,
                agents: new Map([[toUserId, agent]]),
                refType: "reassignment",
              },
            );
          }
          after.owners = leadIds.map((leadId) => ({
            leadId,
            userIds: [userId, ...(toUserId ? [toUserId] : [])],
          }));
          await audit(
            tx,
            context,
            "assignment.reassigned",
            "user",
            userId,
            "A leaver's leads were settled",
            {
              choice: choice.openLeads,
              leads: leadIds.length,
            },
          );
        }
      });
      await afterCommit(after);
      return toUserView(user);
    },

    /** Acts once however many times it runs. Early or stale calls change nothing. */
    async processTimeout(recordId: string): Promise<void> {
      const limit = (await getSetting("assignment.maxTimeouts")) as number;
      const timedOut = await repository.transaction((tx) => settleTimeout(tx, recordId, limit));
      if (!timedOut) return;
      await afterCommit({ timers: [], offers: [], owners: [] });
      if (timedOut.escalated && enqueue) {
        await notify({
          userIds: await managersFor(timedOut.previousOwner),
          kind: "lead_escalated",
          key: `escalated:${recordId}`,
          body: "This lead keeps timing out and is back in the queue.",
          link: `/leads/${timedOut.leadId}`,
        });
      }
    },

    async expirePoolEntry(entryId: string): Promise<void> {
      const expired = await repository.transaction(async (tx) => {
        const entry = await repository.findEntry(tx, entryId);
        if (!entry) return false;
        await lockLeads(tx, [entry.leadId]);
        return repository.markExpired(tx, entryId, clock.now());
      });
      if (expired) await afterCommit({ timers: [], offers: [], owners: [], poolChanged: true });
    },

    /** Every minute: whatever the delayed jobs missed, then new leads for the auto-assign rule. */
    async sweep(): Promise<void> {
      const now = clock.now();
      for (const id of await repository.dueRecordIds(now, SWEEP_LIMIT))
        await this.processTimeout(id);
      for (const id of await repository.dueEntryIds(now, SWEEP_LIMIT))
        await this.expirePoolEntry(id);
      await runAutoAssign(await timeoutMinutes(), await defaultCap());
    },

    async getAutoRule({ principal }: AssignmentContext) {
      assertCan(principal, "assignment:manage-rules");
      const rule = await repository.findAutoRule();
      return {
        enabled: rule?.isActive ?? false,
        mode: (rule?.mode ?? "LEAST_LOADED") as AutoMode,
        priorityBy: (rule?.config as { priorityBy?: PriorityBy } | undefined)?.priorityBy ?? "tier",
      };
    },

    async setAutoRule(context: AssignmentContext, input: AutoRuleInput) {
      assertCan(context.principal, "assignment:manage-rules");
      const now = clock.now();
      await repository.transaction(async (tx) => {
        await repository.lock(tx, ["auto-rule"]);
        const rule = await repository.findAutoRule(tx);
        const config = input.priorityBy ? { priorityBy: input.priorityBy } : {};
        if (!rule) {
          await repository.createRule(tx, {
            name: AUTO_RULE_NAME,
            mode: input.mode,
            config,
            isAutoAssign: true,
            isActive: input.enabled,
            autoAssignedUntil: now,
            createdByUserId: context.principal.userId,
          });
        } else {
          await repository.updateRule(tx, rule.id, {
            mode: input.mode,
            config,
            isActive: input.enabled,
            // Turning it on starts from now, so older leads stay with the manager.
            ...(input.enabled && !rule.isActive ? { autoAssignedUntil: now } : {}),
          });
        }
        await audit(
          tx,
          context,
          "assignment.rule_changed",
          "assignment_rule",
          AUTO_RULE_NAME,
          "Auto-assign rule changed",
          {
            enabled: input.enabled,
            mode: input.mode,
          },
        );
      });
      return this.getAutoRule(context);
    },
  };
}

interface CommitResult {
  batchId: string;
  assignedCount: number;
  pooledCount: number;
  skippedTaken: number;
  leftInQueue: number;
  perAgent: Array<{ userId: string; name: string; count: number }>;
}

export const assignmentService = createAssignmentService();
