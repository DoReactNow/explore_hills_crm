"use client";

// Small pieces the lead screens share.
import Link from "next/link";
import type { FriendlyError } from "@/shared/api/friendlyError";
import {
  formatBusinessDate,
  formatInstant,
  parseInstant,
  todayBusinessDate,
  systemClock,
} from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "./leads.module.css";

export interface StageOption {
  id: string;
  code: string;
  name: string;
  position: number;
  kind: "OPEN" | "WON" | "LOST";
  isActive: boolean;
}

export interface LeadRow {
  id: string;
  source: string;
  destination: string | null;
  travelStartDate: string | null;
  travelEndDate: string | null;
  travellerCount: number | null;
  budgetAmount: string | null;
  customFields: { stay?: string; language?: string };
  lastActivityAt: string | null;
  nextFollowUpDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  createdAt: string;
  version: string;
  contact: { id: string; name: string | null; phoneE164: string; anonymisedAt: string | null };
  stage: { code: string; name: string; kind: string };
  owner: { id: string; name: string; status: string } | null;
}

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export const budgetLabel = (value: string | null) =>
  value === null ? "—" : rupees.format(Number(value));
export const instantLabel = (iso: string | null) =>
  iso ? formatInstant(parseInstant(iso), "dateTime") : "—";
export const dateLabel = (date: string | null) => (date ? formatBusinessDate(date, "date") : "—");

export function tripDates(lead: Pick<LeadRow, "travelStartDate" | "travelEndDate">) {
  const { travelStartDate: start, travelEndDate: end } = lead;
  if (!start && !end) return "—";
  if (start && end && start !== end) return `${dateLabel(start)} – ${dateLabel(end)}`;
  return dateLabel(start ?? end);
}

export function phoneLabel(e164: string) {
  if (e164.startsWith("erased-")) return "Number erased";
  const india = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return india ? `+91 ${india[1]} ${india[2]}` : e164;
}

export function StageChip({ code, name }: { code: string; name: string }) {
  const tone = (styles as Record<string, string>)[`chip${code}`] ?? "";
  return (
    <span className={`${styles.chip} ${tone}`}>
      <span className={styles.dot} />
      {name}
    </span>
  );
}

export function OwnerLabel({ owner }: { owner: LeadRow["owner"] }) {
  return owner ? <>{owner.name}</> : <span className={styles.unassigned}>Unassigned</span>;
}

export function dueClass(date: string | null): string {
  if (!date) return "";
  const today = todayBusinessDate(systemClock);
  if (date < today) return styles.overdue;
  return date === today ? styles.dueToday : "";
}

export const fieldMessage = (error: FriendlyError | null, field: string) =>
  error?.fieldErrors?.find((item) => item.field === field)?.message;

/** A refusal that names an existing lead becomes a link to it. */
export function PhoneConflict({ message }: { message: string }) {
  const match = /(\/leads\/[0-9a-f-]{36})/i.exec(message);
  if (!match) return <span className={styles.fieldError}>{message}</span>;
  return (
    <span className={styles.warnLink}>
      This customer already has an open lead. <Link href={match[1]}>Open that lead</Link>
    </span>
  );
}

export function FormError({
  error,
  fields = [],
}: {
  error: FriendlyError | null;
  fields?: readonly string[];
}) {
  if (!error) return null;
  if (error.fieldErrors?.some((item) => fields.includes(item.field))) return null;
  const root = fieldMessage(error, "_root");
  if (root) {
    return (
      <div role="alert" className={styles.alert}>
        {root}
      </div>
    );
  }
  return <ErrorMessage error={error} />;
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error ? <span className={styles.fieldHint}>{hint}</span> : null}
      {typeof error === "string" ? <span className={styles.fieldError}>{error}</span> : error}
    </div>
  );
}
