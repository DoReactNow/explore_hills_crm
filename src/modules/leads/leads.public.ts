// Small lead operations for other modules, always inside the caller's transaction.
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
