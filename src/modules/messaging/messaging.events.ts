// Live-update notices of the messaging module (Decision 28): IDs only, and only people who may see
// that conversation hear about it.
import { z } from "zod";
import { leadScopeOf } from "@/modules/leads";
import { can } from "@/shared/rbac/guard";
import { defineEventType } from "@/shared/realtime";
import { messagingRepository } from "./messaging.repository";

export const conversationChangedEvent = defineEventType({
  name: "messaging.conversationChanged",
  payload: z.object({ conversationId: z.string() }),
  canReceive: async (principal, { conversationId }) =>
    can(principal, "messaging:view") &&
    messagingRepository.isConversationVisible(conversationId, await leadScopeOf(principal)),
});

export const messagingEventTypes = [conversationChangedEvent];
