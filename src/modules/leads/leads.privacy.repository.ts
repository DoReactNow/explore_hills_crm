// Prisma access for a customer's privacy record: consent, holds, erasure and their data export.
import type { LeadsConsentPurpose, LeadsConsentStatus } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";
import type { Tx } from "./leads.repository";

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** Note and follow-up text is staff's own writing about the customer, so none of it survives. */
export const ERASED_TEXT = "Removed when the customer's data was erased";

const CONTACT_SUMMARY = {
  id: true,
  name: true,
  phoneE164: true,
  email: true,
  optInStatus: true,
  recordingOptOutAt: true,
  legalHoldAt: true,
  anonymisedAt: true,
} as const;

export const privacyRepository = {
  searchContacts(search: string, digits: string, take: number) {
    const term = escapeLike(search);
    return getPrisma().leadsContact.findMany({
      where: {
        anonymisedAt: null,
        OR: [
          ...(digits ? [{ phoneE164: { contains: digits } }] : []),
          { name: { contains: term, mode: "insensitive" as const } },
          { email: { contains: term, mode: "insensitive" as const } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take,
      select: CONTACT_SUMMARY,
    });
  },

  contactRecord(id: string) {
    return getPrisma().leadsContact.findUnique({
      where: { id },
      select: {
        ...CONTACT_SUMMARY,
        consents: {
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            purpose: true,
            status: true,
            source: true,
            occurredAt: true,
            recordedBy: { select: { id: true, name: true } },
          },
        },
        leads: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            closedAt: true,
            stage: { select: { name: true, kind: true } },
          },
        },
      },
    });
  },

  contactForChange: (tx: Tx, id: string) =>
    tx.leadsContact.findUnique({
      where: { id },
      select: {
        id: true,
        phoneE164: true,
        anonymisedAt: true,
        recordingOptOutAt: true,
        legalHoldAt: true,
        optInStatus: true,
      },
    }),

  async addConsent(
    tx: Tx,
    data: {
      contactId: string;
      purpose: LeadsConsentPurpose;
      status: LeadsConsentStatus;
      source: string;
      recordedByUserId: string | null;
      occurredAt: Date;
    },
  ): Promise<void> {
    await tx.leadsConsentRecord.create({ data });
  },

  async setRecordingOptOut(tx: Tx, id: string, at: Date | null): Promise<void> {
    await tx.leadsContact.update({ where: { id }, data: { recordingOptOutAt: at } });
  },

  async setHold(tx: Tx, id: string, at: Date | null): Promise<void> {
    await tx.leadsContact.update({ where: { id }, data: { legalHoldAt: at } });
  },

  hasOpenLead: async (tx: Tx, contactId: string) =>
    (await tx.leadsLead.count({
      where: { contactId, deletedAt: null, stage: { kind: "OPEN" } },
    })) > 0,

  /** Every lead the customer ever had, merged and deleted ones too. */
  async leadIdsOfContact(tx: Tx, contactId: string): Promise<string[]> {
    const rows = await tx.leadsLead.findMany({ where: { contactId }, select: { id: true } });
    return rows.map((row) => row.id);
  },

  /** Empties every personal field. Rows stay, so totals and other records still hold together. */
  async anonymise(
    tx: Tx,
    contactId: string,
    leadIds: readonly string[],
    placeholder: string,
    at: Date,
  ): Promise<void> {
    await tx.leadsContact.update({
      where: { id: contactId },
      data: {
        phoneE164: placeholder,
        name: "Erased customer",
        email: null,
        optInStatus: "OPTED_OUT",
        optInAt: at,
        optInSource: "erasure",
        recordingOptOutAt: at,
        anonymisedAt: at,
      },
    });
    const ids = [...leadIds];
    await tx.leadsLead.updateMany({
      where: { id: { in: ids } },
      data: {
        sourceDetail: null,
        destination: null,
        travelStartDate: null,
        travelEndDate: null,
        travellerCount: null,
        customFields: {},
        nextFollowUpDate: null,
        lostReason: null,
      },
    });
    await tx.leadsNote.updateMany({ where: { leadId: { in: ids } }, data: { body: ERASED_TEXT } });
    await tx.leadsTask.updateMany({ where: { leadId: { in: ids } }, data: { title: ERASED_TEXT } });
    await tx.leadsTask.updateMany({
      where: { leadId: { in: ids }, completedAt: null },
      data: { completedAt: at },
    });
    // Other timeline lines are fixed wording; these two quote what staff typed.
    await tx.leadsTimelineEntry.updateMany({
      where: { leadId: { in: ids }, summary: { startsWith: "Follow-up" } },
      data: { summary: "Follow-up" },
    });
    await tx.leadsTimelineEntry.updateMany({
      where: { leadId: { in: ids }, summary: { startsWith: "Outcome:" } },
      data: { summary: "Call outcome saved" },
    });
  },

  exportRecord(contactId: string) {
    return getPrisma().leadsContact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        name: true,
        phoneE164: true,
        email: true,
        optInStatus: true,
        optInAt: true,
        optInSource: true,
        anonymisedAt: true,
        createdAt: true,
        consents: {
          orderBy: { occurredAt: "asc" },
          select: { purpose: true, status: true, source: true, occurredAt: true },
        },
        leads: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            createdAt: true,
            source: true,
            sourceDetail: true,
            destination: true,
            travelStartDate: true,
            travelEndDate: true,
            travellerCount: true,
            budgetAmount: true,
            customFields: true,
            closedAt: true,
            lostReason: true,
            stage: { select: { name: true } },
            notes: { orderBy: { createdAt: "asc" }, select: { createdAt: true, body: true } },
            tasks: {
              orderBy: { createdAt: "asc" },
              select: { title: true, dueDate: true, completedAt: true },
            },
            timeline: {
              orderBy: { occurredAt: "asc" },
              select: { occurredAt: true, summary: true },
            },
          },
        },
      },
    });
  },
};
