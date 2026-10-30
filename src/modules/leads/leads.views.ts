// The shape a lead takes when it leaves the server: dates as YYYY-MM-DD, money as a string.
import { dbDateToBusinessDate } from "@/shared/time";
import type { LeadRow, TaskRow } from "./leads.repository";

const dateOrNull = (value: Date | null) => (value ? dbDateToBusinessDate(value) : null);

function knownCustomFields(value: unknown): { stay?: string; language?: string } {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    ...(typeof source.stay === "string" ? { stay: source.stay } : {}),
    ...(typeof source.language === "string" ? { language: source.language } : {}),
  };
}

export function toLeadView(lead: LeadRow) {
  return {
    ...lead,
    travelStartDate: dateOrNull(lead.travelStartDate),
    travelEndDate: dateOrNull(lead.travelEndDate),
    nextFollowUpDate: dateOrNull(lead.nextFollowUpDate),
    budgetAmount: lead.budgetAmount?.toString() ?? null,
    customFields: knownCustomFields(lead.customFields),
    version: lead.updatedAt.toISOString(),
  };
}

export type LeadView = ReturnType<typeof toLeadView>;

export const toTaskView = (task: TaskRow) => ({
  ...task,
  dueDate: dbDateToBusinessDate(task.dueDate),
});

export type TaskView = ReturnType<typeof toTaskView>;
