// What the privacy module may do to a customer's record. The rules live with it; this keeps the data
// here, and records every consent change the same way (P10-ERASE-08).
import { recordAudit } from "@/modules/audit";
import { AppError } from "@/shared/errors";
import { dbDateToBusinessDate } from "@/shared/time";
import { leadRepository, type Tx } from "./leads.repository";
import { privacyRepository as repository } from "./leads.privacy.repository";

export const lockContactPhone = leadRepository.lockPhone;
export const findContactRecord = repository.contactRecord;
export const findContactForChange = repository.contactForChange;
export const contactHasOpenLead = repository.hasOpenLead;
export const leadIdsOfContact = repository.leadIdsOfContact;
export const setRecordingOptOut = repository.setRecordingOptOut;
export const setContactHold = repository.setHold;
export const addConsentRecord = repository.addConsent;

export async function searchContacts(search: string, take: number) {
  const digits = search.replace(/\D/g, "");
  return repository.searchContacts(search, digits.length >= 4 ? digits : "", take);
}

/** No digits, so it can never be mistaken for a number or turn up in a phone search. */
function erasedPhone(contactId: string): string {
  const letters = contactId
    .replaceAll("-", "")
    .replace(/\d/g, (digit) => "ghijklmnop"[Number(digit)]);
  return `erased-${letters}`;
}

/** Empties the customer's own fields and returns their lead IDs, for the other modules to do theirs. */
export async function anonymiseContact(tx: Tx, contactId: string, at: Date): Promise<string[]> {
  const leadIds = await repository.leadIdsOfContact(tx, contactId);
  await repository.anonymise(tx, contactId, leadIds, erasedPhone(contactId), at);
  return leadIds;
}

/** A closed lead whose customer was erased can't be reopened, edited or added to. */
export function assertNotErased(contact: { anonymisedAt: Date | null }): void {
  if (contact.anonymisedAt) {
    throw new AppError("CONFLICT", {
      fieldErrors: [
        { field: "_root", message: "This customer's data was erased, so this lead can't change." },
      ],
    });
  }
}

export async function recordingRefused(
  tx: Tx,
  leadId: string | null,
  phoneE164: string,
): Promise<boolean> {
  const contact = leadId
    ? (
        await tx.leadsLead.findUnique({
          where: { id: leadId },
          select: { contact: { select: { recordingOptOutAt: true } } },
        })
      )?.contact
    : await tx.leadsContact.findUnique({
        where: { phoneE164 },
        select: { recordingOptOutAt: true },
      });
  return Boolean(contact?.recordingOptOutAt);
}

export async function exportContactRecord(contactId: string) {
  const contact = await repository.exportRecord(contactId);
  if (!contact) return null;
  return {
    name: contact.name,
    phone: contact.phoneE164,
    email: contact.email,
    whatsappConsent: contact.optInStatus,
    firstContactAt: contact.createdAt,
    consents: contact.consents,
    leads: contact.leads.map((lead) => ({
      createdAt: lead.createdAt,
      source: lead.source,
      sourceDetail: lead.sourceDetail,
      destination: lead.destination,
      travelStartDate: lead.travelStartDate ? dbDateToBusinessDate(lead.travelStartDate) : null,
      travelEndDate: lead.travelEndDate ? dbDateToBusinessDate(lead.travelEndDate) : null,
      travellerCount: lead.travellerCount,
      budget: lead.budgetAmount?.toString() ?? null,
      otherDetails: lead.customFields,
      stage: lead.stage.name,
      closedAt: lead.closedAt,
      lostReason: lead.lostReason,
      notes: lead.notes,
      followUps: lead.tasks.map((task) => ({
        title: task.title,
        dueDate: dbDateToBusinessDate(task.dueDate),
        completedAt: task.completedAt,
      })),
      history: lead.timeline,
    })),
    leadIds: contact.leads.map((lead) => lead.id),
  };
}

/** The audit line for a consent change, used for both kinds of consent. */
export const auditConsent = (
  tx: Tx,
  input: {
    contactId: string;
    purpose: string;
    status: string;
    source: string;
    actor: { userId: string; roleCode: string } | null;
    requestId?: string;
  },
) =>
  recordAudit(tx, {
    action: "contact.consent_changed",
    entityType: "contact",
    entityId: input.contactId,
    summary: "Customer consent changed",
    actor: input.actor,
    requestId: input.requestId,
    metadata: { purpose: input.purpose, status: input.status, source: input.source },
  });
