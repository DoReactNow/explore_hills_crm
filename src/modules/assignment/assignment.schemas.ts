// What the assignment routes accept.
import { z } from "zod";
import { isBusinessDate } from "@/shared/time";
import { ASSIGN_MODES, AUTO_MODES, MAX_BATCH } from "./assignment.types";

const id = z.uuid();
const priorityBy = z.enum(["tier", "value"]).optional();
const businessDate = z.string().refine(isBusinessDate, "Please enter a date.");
const tag = z.string().trim().min(1).max(60);

export const listQueueSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  filter: z.enum(["all", "waiting", "whatsapp"]).default("all"),
  search: z.string().trim().max(100).optional(),
});
export type ListQueueInput = z.infer<typeof listQueueSchema>;

export const previewSchema = z.object({
  leadIds: z.array(id).max(MAX_BATCH).optional(),
  all: z.boolean().optional(),
  userIds: z.array(id).max(500),
  mode: z.enum([...ASSIGN_MODES, "BLAST"]),
  priorityBy,
});
export type PreviewInput = z.infer<typeof previewSchema>;

export const commitSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  mode: z.enum([...ASSIGN_MODES, "BLAST"]),
  rows: z
    .array(z.object({ leadId: id, userId: id }))
    .max(MAX_BATCH)
    .optional(),
  offers: z
    .object({ leadIds: z.array(id).min(1).max(MAX_BATCH), userIds: z.array(id).max(500) })
    .optional(),
});
export type CommitInput = z.infer<typeof commitSchema>;

export const agentSettingsSchema = z.object({
  isAvailable: z.boolean(),
  openLeadCap: z.number().int().min(0).max(10000).nullable(),
  priorityTier: z.number().int().min(0).max(100),
  languages: z.array(tag).max(30),
  destinations: z.array(tag).max(100),
  leaveFromDate: businessDate.nullable(),
  leaveToDate: businessDate.nullable(),
  shifts: z
    .array(
      z
        .object({
          weekday: z.number().int().min(0).max(6),
          startMinute: z.number().int().min(0).max(1439),
          endMinute: z.number().int().min(0).max(1439),
        })
        .refine((shift) => shift.startMinute !== shift.endMinute, {
          message: "A shift can't start and end at the same time.",
        }),
    )
    .max(50),
});
export type AgentSettingsInput = z.infer<typeof agentSettingsSchema>;

export const autoRuleSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(AUTO_MODES),
  priorityBy,
});
export type AutoRuleInput = z.infer<typeof autoRuleSchema>;

export const reassignSchema = z.object({
  toUserId: id,
  reason: z.string().trim().min(1, "Please give a reason.").max(500),
});
export type ReassignInput = z.infer<typeof reassignSchema>;

export const deactivateSchema = z.discriminatedUnion("openLeads", [
  z.object({ openLeads: z.literal("queue") }),
  z.object({ openLeads: z.literal("keep") }),
  z.object({ openLeads: z.literal("agent"), toUserId: id }),
]);
export type DeactivateChoice = z.infer<typeof deactivateSchema>;
