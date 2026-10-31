// Live-update notices of the telephony module (Decision 28): IDs only.
import { z } from "zod";
import { isLeadVisible, leadScopeOf } from "@/modules/leads";
import { can } from "@/shared/rbac/guard";
import { defineEventType } from "@/shared/realtime";

/** For the agent on the call, and anyone who may see its lead. */
export const callChangedEvent = defineEventType({
  name: "telephony.callChanged",
  payload: z.object({ callId: z.string(), agentUserId: z.string(), leadId: z.string() }),
  canReceive: async (principal, { agentUserId, leadId }) =>
    agentUserId === principal.userId ||
    (Boolean(leadId) && (await isLeadVisible(leadId as string, await leadScopeOf(principal)))),
});

/** A missed call or a lost recording: Admins and the managers above the lead's owner (Decision 61). */
export const callAlertEvent = defineEventType({
  name: "telephony.alert",
  payload: z.object({ kind: z.string(), callId: z.string(), leadId: z.string() }),
  canReceive: async (principal, { leadId }) =>
    can(principal, "leads:assign") &&
    (!leadId || (await isLeadVisible(leadId, await leadScopeOf(principal)))),
});

export const telephonyEventTypes = [callChangedEvent, callAlertEvent];
