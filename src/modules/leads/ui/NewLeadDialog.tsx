"use client";

// The New lead form. Whoever can assign leads picks an owner or leaves it for the queue; anyone else
// owns what they create, so the Owner field isn't offered to them.
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { Dialog } from "@/shared/ui/Dialog";
import { MANUAL_SOURCES, SOURCE_LABELS } from "../leads.types";
import { Field, FormError, PhoneConflict, fieldMessage } from "./shared";
import styles from "./leads.module.css";

const FIELDS = [
  "customerName",
  "phone",
  "destination",
  "travelStartDate",
  "travelEndDate",
  "travellerCount",
  "budgetAmount",
  "source",
  "ownerUserId",
  "note",
];

export function NewLeadDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { can } = usePrincipal();
  const canAssign = can("leads:assign");
  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    destination: "",
    travelStartDate: "",
    travelEndDate: "",
    travellerCount: "",
    budgetAmount: "",
    source: "MANUAL",
    ownerUserId: "",
    note: "",
  });
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canAssign || !can("users:view")) return;
    apiRequest<{ items: Array<{ id: string; name: string }> }>(
      "/api/users?status=ACTIVE&pageSize=200",
    ).then((result) => {
      if (result.ok) setPeople(result.data.items);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAssign]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const count = form.travellerCount.trim();
    const result = await apiRequest<{ id: string }>("/api/leads", {
      method: "POST",
      body: {
        customerName: form.customerName,
        phone: form.phone,
        source: form.source,
        destination: form.destination || null,
        travelStartDate: form.travelStartDate || null,
        travelEndDate: form.travelEndDate || null,
        travellerCount: count ? Number(count) : null,
        budgetAmount: form.budgetAmount.replace(/[,\s]/g, "") || null,
        ownerUserId: form.ownerUserId || null,
        note: form.note || null,
      },
    });
    setBusy(false);
    if (result.ok) onCreated(result.data.id);
    else setError(result.error);
  }

  const phoneError = fieldMessage(error, "phone");

  return (
    <Dialog title="New lead" onClose={onClose}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <FormError error={error} fields={FIELDS} />
        <div className={styles.grid}>
          <Field id="nl-name" label="Customer name" error={fieldMessage(error, "customerName")}>
            <input
              id="nl-name"
              className={styles.control}
              value={form.customerName}
              onChange={set("customerName")}
            />
          </Field>
          <Field
            id="nl-phone"
            label="Phone"
            hint="Numbers without a country code are read as Indian."
            error={phoneError ? <PhoneConflict message={phoneError} /> : undefined}
          >
            <input
              id="nl-phone"
              type="tel"
              className={styles.control}
              value={form.phone}
              onChange={set("phone")}
            />
          </Field>
          <Field id="nl-dest" label="Destination" error={fieldMessage(error, "destination")}>
            <input
              id="nl-dest"
              className={styles.control}
              value={form.destination}
              onChange={set("destination")}
            />
          </Field>
          <Field id="nl-count" label="Travellers" error={fieldMessage(error, "travellerCount")}>
            <input
              id="nl-count"
              inputMode="numeric"
              className={styles.control}
              value={form.travellerCount}
              onChange={set("travellerCount")}
            />
          </Field>
          <Field id="nl-start" label="Travel from" error={fieldMessage(error, "travelStartDate")}>
            <input
              id="nl-start"
              type="date"
              className={styles.control}
              value={form.travelStartDate}
              onChange={set("travelStartDate")}
            />
          </Field>
          <Field id="nl-end" label="Travel to" error={fieldMessage(error, "travelEndDate")}>
            <input
              id="nl-end"
              type="date"
              className={styles.control}
              value={form.travelEndDate}
              onChange={set("travelEndDate")}
            />
          </Field>
          <Field
            id="nl-budget"
            label="Budget (₹)"
            hint="Total for the group"
            error={fieldMessage(error, "budgetAmount")}
          >
            <input
              id="nl-budget"
              inputMode="decimal"
              className={styles.control}
              value={form.budgetAmount}
              onChange={set("budgetAmount")}
            />
          </Field>
          <Field id="nl-source" label="Source" error={fieldMessage(error, "source")}>
            <select
              id="nl-source"
              className={styles.control}
              value={form.source}
              onChange={set("source")}
            >
              {MANUAL_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </Field>
          {canAssign ? (
            <Field id="nl-owner" label="Owner" error={fieldMessage(error, "ownerUserId")}>
              <select
                id="nl-owner"
                className={styles.control}
                value={form.ownerUserId}
                onChange={set("ownerUserId")}
              >
                <option value="">Leave unassigned (goes to queue)</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className={`${styles.field} ${styles.full}`}>
            <label htmlFor="nl-note">What did they ask for?</label>
            <textarea
              id="nl-note"
              className={styles.textarea}
              value={form.note}
              onChange={set("note")}
            />
            {fieldMessage(error, "note") ? (
              <span className={styles.fieldError}>{fieldMessage(error, "note")}</span>
            ) : null}
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
            {busy ? "Saving…" : "Create lead"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
