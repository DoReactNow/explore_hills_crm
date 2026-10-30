"use client";

// Small pieces the Employees, Teams and Roles screens share.
import type { FriendlyError } from "@/shared/api/friendlyError";
import { formatInstant, parseInstant } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "./people.module.css";

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  phoneE164: string | null;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  role: { code: string; name: string };
  manager: { id: string; name: string } | null;
  teamMemberships: Array<{ team: { id: string; name: string } }>;
  canManage: boolean;
}

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  INVITED: "Invited",
  DEACTIVATED: "Inactive",
};

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

export const whenLabel = (iso: string | null) =>
  iso ? formatInstant(parseInstant(iso), "dateTime") : "Never";

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? styles.badgeActive
      : status === "DEACTIVATED"
        ? styles.badgeInactive
        : styles.badgeOther;
  return <span className={`${styles.badge} ${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span className={`${styles.avatar} ${large ? styles.avatarLarge : ""}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export const fieldMessage = (error: FriendlyError | null, field: string) =>
  error?.fieldErrors?.find((item) => item.field === field)?.message;

/** The message for the whole form: the specific reason when there is one, else the catalog's. */
export function FormError({
  error,
  fields = [],
}: {
  error: FriendlyError | null;
  fields?: readonly string[];
}) {
  if (!error) return null;
  const specific = error.fieldErrors?.some((item) => fields.includes(item.field));
  if (specific) return null;
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
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error ? <span className={styles.fieldHint}>{hint}</span> : null}
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </div>
  );
}
