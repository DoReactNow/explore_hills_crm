// What the audit trail routes accept.
import { z } from "zod";
import { isBusinessDate } from "@/shared/time";
import { AUDIT_ACTIONS } from "./audit.types";

const date = z.string().refine(isBusinessDate, "Please enter a date.");

export const auditFiltersSchema = z.object({
  actorId: z.union([z.uuid(), z.literal("system")]).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().min(2).max(100).optional(),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

export const auditListSchema = auditFiltersSchema.extend({ after: z.uuid().optional() });
export type AuditListInput = z.infer<typeof auditListSchema>;
