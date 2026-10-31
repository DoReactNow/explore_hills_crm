// What the report routes accept.
import { z } from "zod";
import { isBusinessDate } from "@/shared/time";

const date = z.string().refine(isBusinessDate, "Please enter a date.");

export const reportFiltersSchema = z.object({
  from: date,
  to: date,
  agentId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  source: z.enum(["WHATSAPP", "PHONE", "MANUAL", "WEBSITE", "AD", "IMPORT"]).optional(),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const EXPORT_KINDS = [
  "volume",
  "assignment",
  "response",
  "funnel",
  "agents",
  "leads",
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const exportSchema = reportFiltersSchema.extend({ kind: z.enum(EXPORT_KINDS) });
export type ExportInput = z.infer<typeof exportSchema>;

export const dashboardSchema = z.object({
  range: z.enum(["today", "7", "30"]).default("today"),
});
export type DashboardInput = z.infer<typeof dashboardSchema>;
