// Types and constants of the leads module that UI code may import (no Prisma here).

/** Mirrors the Prisma enums (parity is unit-tested). */
export const LEAD_SOURCES = ["WHATSAPP", "PHONE", "MANUAL", "WEBSITE", "AD", "IMPORT"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const STAGE_KINDS = ["OPEN", "WON", "LOST"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
  MANUAL: "Added by hand",
  WEBSITE: "Website",
  AD: "Ad",
  IMPORT: "Import",
};

/** Sources a person can pick by hand; the others are set by integrations. */
export const MANUAL_SOURCES = ["PHONE", "MANUAL", "WEBSITE", "AD"] as const;

export const LOST_REASONS = [
  "Price too high",
  "Booked with someone else",
  "Dates changed or trip cancelled",
  "Not reachable after 3 tries",
  "Only asking for information",
  "Other",
] as const;

export const LEAD_SORTS = [
  "customer",
  "phone",
  "destination",
  "travelStartDate",
  "travellerCount",
  "budgetAmount",
  "stage",
  "owner",
  "lastActivityAt",
  "nextFollowUpDate",
  "source",
  "createdAt",
] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const FOLLOW_UP_BUCKETS = ["open", "overdue", "today", "upcoming", "completed"] as const;
export type FollowUpBucket = (typeof FOLLOW_UP_BUCKETS)[number];
