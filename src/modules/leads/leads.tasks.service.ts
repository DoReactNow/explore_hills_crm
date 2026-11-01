// Follow-ups (Decision 57). "Today" and "overdue" use the business day, not the server's or UTC's.
import { randomUUID } from "node:crypto";
import { getUserSummary } from "@/modules/identity";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import {
  businessDateToDbDate,
  systemClock,
  todayBusinessDate,
  toIsoInstant,
  type Clock,
} from "@/shared/time";
import { inScope, leadScopeOf } from "./leads.access";
import { assertNotErased } from "./leads.privacy";
import { leadRepository, type LeadRepository } from "./leads.repository";
import type { AddTaskInput, ListFollowUpsInput, SetTaskInput } from "./leads.schemas";
import { isUuid, type LeadContext } from "./leads.service";
import { toTaskView } from "./leads.views";

const notFound = () => new AppError("NOT_FOUND");
const invalid = (field: string, message: string) =>
  new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message }] });

export function createTaskService({
  repository = leadRepository,
  clock = systemClock,
}: { repository?: LeadRepository; clock?: Clock } = {}) {
  return {
    async addTask({ principal }: LeadContext, leadId: string, input: AddTaskInput) {
      assertCan(principal, "leads:edit");
      if (!isUuid(leadId)) throw notFound();
      const scope = await leadScopeOf(principal);
      if (input.dueDate < todayBusinessDate(clock)) {
        throw invalid("dueDate", "Please choose today or a later date.");
      }
      const assigneeUserId = input.assigneeUserId ?? principal.userId;
      if (input.assigneeUserId) {
        const refuse = () =>
          invalid("assigneeUserId", "Please choose an active person you manage.");
        if (!isUuid(assigneeUserId) || !inScope(scope, assigneeUserId)) throw refuse();
        if ((await getUserSummary(assigneeUserId))?.status !== "ACTIVE") throw refuse();
      }
      const now = clock.now();
      return repository.transaction(async (tx) => {
        const lead = await repository.findLead(tx, leadId, scope);
        if (!lead) throw notFound();
        assertNotErased(lead.contact);
        const task = await repository.createTask(tx, {
          leadId,
          assigneeUserId,
          title: input.title,
          dueDate: businessDateToDbDate(input.dueDate),
        });
        await repository.addTimeline(tx, {
          leadId,
          kind: "TASK",
          summary: `Follow-up added: ${input.title}`,
          refType: "task",
          refId: task.id,
          actorUserId: principal.userId,
          occurredAt: now,
        });
        await repository.refreshNextFollowUp(tx, leadId);
        await repository.touchActivity(tx, leadId, now);
        return toTaskView(task);
      });
    },

    /** Completing twice changes nothing more; a done task can be reopened. */
    async setCompleted(
      { principal }: LeadContext,
      leadId: string,
      taskId: string,
      { completed }: SetTaskInput,
    ) {
      assertCan(principal, "leads:edit");
      if (!isUuid(leadId) || !isUuid(taskId)) throw notFound();
      const scope = await leadScopeOf(principal);
      const now = clock.now();
      return repository.transaction(async (tx) => {
        if (!(await repository.findLead(tx, leadId, scope))) throw notFound();
        const task = await repository.findTask(tx, leadId, taskId);
        if (!task) throw notFound();
        const changed = await repository.setTaskCompleted(tx, taskId, completed ? now : null);
        if (changed) {
          await repository.addTimeline(tx, {
            leadId,
            kind: "TASK",
            summary: `${completed ? "Follow-up done" : "Follow-up reopened"}: ${task.title}`,
            refType: completed ? "task_done" : "task_reopened",
            refId: randomUUID(),
            actorUserId: principal.userId,
            occurredAt: now,
          });
          await repository.refreshNextFollowUp(tx, leadId);
          await repository.touchActivity(tx, leadId, now);
        }
        const fresh = await repository.findTask(tx, leadId, taskId);
        return toTaskView(fresh!);
      });
    },

    /** This person's follow-ups on open leads. A closed lead stops reminding. */
    async listFollowUps({ principal }: LeadContext, { bucket }: ListFollowUpsInput) {
      const scope = await leadScopeOf(principal);
      const today = businessDateToDbDate(todayBusinessDate(clock));
      const buckets = {
        open: { completedAt: null },
        overdue: { completedAt: null, dueDate: { lt: today } },
        today: { completedAt: null, dueDate: today },
        upcoming: { completedAt: null, dueDate: { gt: today } },
        completed: { completedAt: { not: null } },
      };
      const [rows, overdue, dueToday, upcoming] = await Promise.all([
        repository.listFollowUps(
          principal.userId,
          scope,
          buckets[bucket],
          bucket === "completed" ? "desc" : "asc",
        ),
        repository.countFollowUps(principal.userId, scope, buckets.overdue),
        repository.countFollowUps(principal.userId, scope, buckets.today),
        repository.countFollowUps(principal.userId, scope, buckets.upcoming),
      ]);
      return {
        items: rows.map((row) => ({
          ...toTaskView(row),
          lead: row.lead,
          overdue: !row.completedAt && row.dueDate.getTime() < today.getTime(),
          completedAt: row.completedAt ? toIsoInstant(row.completedAt) : null,
        })),
        counts: { overdue, today: dueToday, upcoming },
      };
    },
  };
}

export const taskService = createTaskService();
