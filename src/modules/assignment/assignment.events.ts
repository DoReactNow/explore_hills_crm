// Live-update notices of the assignment module (Decision 28): IDs only.
import { z } from "zod";
import { can } from "@/shared/rbac/guard";
import { defineEventType } from "@/shared/realtime";

export const queueChangedEvent = defineEventType({
  name: "assignment.queueChanged",
  payload: z.object({}),
  canReceive: async (principal) => can(principal, "leads:assign"),
});

export const poolChangedEvent = defineEventType({
  name: "assignment.poolChanged",
  payload: z.object({}),
  canReceive: async (principal) => can(principal, "leads:claim") || can(principal, "leads:assign"),
});

/** Reaches the people concerned, so an old owner's open screen finds out at once (P5-REASSIGN-05). */
export const leadOwnerChangedEvent = defineEventType({
  name: "assignment.leadOwnerChanged",
  // Comma-separated, because notices carry only plain strings.
  payload: z.object({ leadId: z.string(), userIds: z.string() }),
  canReceive: async (principal, { userIds }) =>
    (userIds ?? "").split(",").includes(principal.userId) || can(principal, "leads:assign"),
});

export const assignmentEventTypes = [queueChangedEvent, poolChangedEvent, leadOwnerChangedEvent];
