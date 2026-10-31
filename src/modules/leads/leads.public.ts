// Small lead operations for other modules, always inside the caller's transaction.
import type { LeadContext } from "./leads.service";
import { taskService } from "./leads.tasks.service";
import {
  leadRepository,
  scopeWhere,
  type LeadScope,
  type NewTimelineEntry,
  type Tx,
} from "./leads.repository";

export { scopeWhere };

export const addLeadTimeline = (tx: Tx, entry: NewTimelineEntry) =>
  leadRepository.addTimeline(tx, entry);

export const touchLeadActivity = (tx: Tx, id: string, at: Date) =>
  leadRepository.touchActivity(tx, id, at);

/** A lead this person may see, with what's needed to start a chat. */
export async function findLeadForChat(tx: Tx, id: string, scope: LeadScope) {
  const lead = await leadRepository.findLead(tx, id, scope);
  return lead && { id: lead.id, contactId: lead.contact.id, phoneE164: lead.contact.phoneE164 };
}

export const lockLeads = leadRepository.lockLeads;
export const findWaitingLeads = leadRepository.findWaitingLeads;
export const setLeadOwner = leadRepository.setOwner;
export const moveOpenTasks = leadRepository.moveOpenTasks;
export const firstOwnerAction = leadRepository.firstOwnerAction;
export const countOpenLeads = leadRepository.countOpenLeads;
export const openLeadIdsOf = leadRepository.openLeadIdsOf;
export const addLeadTimelines = leadRepository.addTimelines;

/** The language asked for on a lead, if any. */
export function languageOfLead(customFields: unknown): string | null {
  const value = (customFields as { language?: unknown } | null)?.language;
  return typeof value === "string" && value ? value : null;
}

/** A lead this person may see, with what's needed to call its customer. */
export function findLeadForCall(tx: Tx, id: string, scope: LeadScope) {
  return tx.leadsLead.findFirst({
    where: { id, deletedAt: null, ...scopeWhere(scope) },
    select: {
      id: true,
      ownerUserId: true,
      contact: { select: { phoneE164: true, anonymisedAt: true, deletedAt: true } },
    },
  });
}

/** Who owns a lead, for routing a call. */
export function findLeadOwner(tx: Tx, id: string) {
  return tx.leadsLead.findUnique({ where: { id }, select: { ownerUserId: true } });
}

export const isLeadVisible = leadRepository.isLeadVisible;

/** A follow-up the system adds, such as calling back after a missed call. */
export async function addSystemFollowUp(
  tx: Tx,
  input: { leadId: string; assigneeUserId: string; title: string; dueDate: Date; at: Date },
): Promise<void> {
  const task = await leadRepository.createTask(tx, {
    leadId: input.leadId,
    assigneeUserId: input.assigneeUserId,
    title: input.title,
    dueDate: input.dueDate,
  });
  await leadRepository.addTimeline(tx, {
    leadId: input.leadId,
    kind: "TASK",
    summary: `Follow-up added: ${input.title}`,
    refType: "task",
    refId: task.id,
    occurredAt: input.at,
  });
  await leadRepository.refreshNextFollowUp(tx, input.leadId);
}

/** A follow-up someone asks for, under the usual rules. */
export const createTaskForLead = (
  context: LeadContext,
  leadId: string,
  input: { title: string; dueDate: string },
) => taskService.addTask(context, leadId, input);

export const leadsAwaitingResponse = leadRepository.leadsAwaitingResponse;
export const followUpsDue = leadRepository.followUpsDue;
