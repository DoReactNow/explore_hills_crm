// Live-update notices of the leads module (Decision 28): IDs only, and only people who may see that
// lead hear about it. They keep a second tab, and anyone else looking at the lead, up to date.
import { z } from "zod";
import { logger } from "@/shared/logger";
import { defineEventType } from "@/shared/realtime";
import { publishEvent } from "@/shared/realtime/publish";
import { leadScopeOf } from "./leads.access";
import { leadRepository } from "./leads.repository";

export const leadChangedEvent = defineEventType({
  name: "leads.leadChanged",
  payload: z.object({ leadId: z.string() }),
  canReceive: async (principal, { leadId }) =>
    leadRepository.isLeadVisible(leadId, await leadScopeOf(principal)),
});

export const leadEventTypes = [leadChangedEvent];

export const announceLead = (leadId: string) =>
  publishEvent(leadChangedEvent, { leadId }).catch((error: unknown) =>
    logger.warn("could not publish a lead notice", { err: error }),
  );
