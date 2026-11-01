"use client";

// Customer privacy: consent, holds, a copy of the customer's data, and erasure. Everything said here
// matches what the server enforces; erasure asks for the customer's number, so it can't hit the wrong
// person by a slip.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { formatInstant, parseInstant } from "@/shared/time";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "./privacy.module.css";

interface ContactSummary {
  id: string;
  name: string | null;
  phoneE164: string;
  email: string | null;
  optInStatus: string;
  recordingOptOutAt: string | null;
  legalHoldAt: string | null;
  anonymisedAt: string | null;
}
interface ContactRecord extends ContactSummary {
  consents: Array<{
    id: string;
    purpose: string;
    status: string;
    source: string;
    occurredAt: string;
    recordedBy: { id: string; name: string } | null;
  }>;
  leads: Array<{
    id: string;
    createdAt: string;
    closedAt: string | null;
    stage: { name: string; kind: string };
  }>;
}

const PURPOSES: Record<string, string> = {
  WHATSAPP: "WhatsApp messages",
  CALL_RECORDING: "Call recording",
};
const SOURCES: Record<string, string> = {
  phone_call: "On a phone call",
  email: "By email",
  in_person: "In person",
  written_form: "On a written form",
  whatsapp_keyword: "WhatsApp keyword",
  whatsapp_inbound: "Customer messaged us",
  erasure: "Data erased",
  unknown: "Not recorded",
};
const HOLD_REASONS: Record<string, string> = {
  legal_claim: "A legal claim",
  open_complaint: "An open complaint",
  regulator_request: "A regulator's request",
};
const when = (value: string) => formatInstant(parseInstant(value), "dateTime");
const STAFF_SOURCES = ["phone_call", "email", "in_person", "written_form"];

/** The server's own reason where it gave one, such as "This customer has an open lead." */
function Problem({ error }: { error: FriendlyError }) {
  if (!error.fieldErrors?.length) return <ErrorMessage error={error} />;
  return (
    <div role="alert">
      {error.fieldErrors.map((item) => (
        <p key={item.field}>{item.message}</p>
      ))}
    </div>
  );
}

function ConsentDialog({
  contactId,
  purpose,
  withdraw,
  onClose,
  onSaved,
}: {
  contactId: string;
  purpose: string;
  withdraw: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [source, setSource] = useState(STAFF_SOURCES[0]);
  const [error, setError] = useState<FriendlyError | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest(`/api/privacy/contacts/${contactId}/consent`, {
      method: "POST",
      body: { purpose, status: withdraw ? "WITHDRAWN" : "GRANTED", source },
    });
    if (result.ok) onSaved();
    else setError(result.error);
  }
  return (
    <Dialog
      title={`${withdraw ? "Withdraw" : "Record"} consent: ${PURPOSES[purpose]}`}
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={submit}>
        <p className={styles.warning}>
          {purpose === "WHATSAPP"
            ? withdraw
              ? "We'll stop sending this customer WhatsApp messages."
              : "We can message this customer on WhatsApp again."
            : withdraw
              ? "New recordings of this customer's calls won't be kept. Earlier ones stay until their date, or until you erase the customer."
              : "New recordings of this customer's calls will be kept."}
        </p>
        <label className={styles.field}>
          How did the customer tell us?
          <select
            className={styles.input}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            {STAFF_SOURCES.map((key) => (
              <option key={key} value={key}>
                {SOURCES[key]}
              </option>
            ))}
          </select>
        </label>
        {error ? <Problem error={error} /> : null}
        <div className={styles.formActions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function HoldDialog({
  contactId,
  onClose,
  onSaved,
}: {
  contactId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState(Object.keys(HOLD_REASONS)[0]);
  const [error, setError] = useState<FriendlyError | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest(`/api/privacy/contacts/${contactId}/hold`, {
      method: "POST",
      body: { on: true, reason },
    });
    if (result.ok) onSaved();
    else setError(result.error);
  }
  return (
    <Dialog title="Place a hold" onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <p className={styles.warning}>
          While the hold lasts, this customer&apos;s messages and recordings aren&apos;t deleted by
          date, and their data can&apos;t be erased.
        </p>
        <label className={styles.field}>
          Why is it needed?
          <select
            className={styles.input}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {Object.entries(HOLD_REASONS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error ? <Problem error={error} /> : null}
        <div className={styles.formActions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`}>
            Place hold
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function EraseDialog({
  contact,
  onClose,
  onSaved,
}: {
  contact: ContactRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [confirmPhone, setConfirmPhone] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest(`/api/privacy/contacts/${contact.id}/erase`, {
      method: "POST",
      body: { confirmPhone },
    });
    if (result.ok) onSaved();
    else setError(result.error);
  }
  return (
    <Dialog title={`Erase ${contact.name ?? "this customer"}'s data?`} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.warning}>
          This removes their name, number, email, trip details, notes, messages, files and call
          recordings for good. It can&apos;t be undone. Totals in reports stay, without their name.
          Copies in backups go when those backups expire.
        </p>
        <label className={styles.field}>
          Type the customer&apos;s number to confirm
          <input
            className={styles.input}
            inputMode="tel"
            autoComplete="off"
            value={confirmPhone}
            onChange={(event) => setConfirmPhone(event.target.value)}
          />
        </label>
        {error ? <Problem error={error} /> : null}
        <div className={styles.formActions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.dangerFill}`}>
            Erase for good
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ContactPanel({ contactId }: { contactId: string }) {
  const { can } = usePrincipal();
  const [data, setData] = useState<{ contact: ContactRecord; filesWaiting: number } | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "consent"; purpose: string; withdraw: boolean } | { kind: "hold" | "erase" } | null
  >(null);

  const load = useCallback(async () => {
    const result = await apiRequest<{ contact: ContactRecord; filesWaiting: number }>(
      `/api/privacy/contacts/${contactId}`,
    );
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(result.error);
  }, [contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when the customer changes
    void load();
  }, [load]);

  if (error) return <ErrorMessage error={error} />;
  if (!data) return <p className={styles.muted}>Loading…</p>;
  const { contact, filesWaiting } = data;
  const erased = Boolean(contact.anonymisedAt);
  const saved = () => {
    setDialog(null);
    void load();
  };
  async function releaseHold() {
    const result = await apiRequest(`/api/privacy/contacts/${contactId}/hold`, {
      method: "POST",
      body: { on: false },
    });
    if (result.ok) {
      setActionError(null);
      void load();
    } else setActionError(result.error);
  }
  const openLeads = contact.leads.filter((lead) => lead.stage.kind === "OPEN");
  const whatsappLabel: Record<string, string> = {
    OPTED_IN: "allowed",
    OPTED_OUT: "withdrawn",
    UNKNOWN: "not given yet",
  };
  const consents = [
    {
      purpose: "WHATSAPP",
      label: whatsappLabel[contact.optInStatus],
      canAllow: contact.optInStatus !== "OPTED_IN",
      canWithdraw: contact.optInStatus !== "OPTED_OUT",
    },
    {
      purpose: "CALL_RECORDING",
      label: contact.recordingOptOutAt ? "withdrawn" : "on, with the announcement",
      canAllow: Boolean(contact.recordingOptOutAt),
      canWithdraw: !contact.recordingOptOutAt,
    },
  ];

  return (
    <>
      <section className={styles.card} aria-label="Customer">
        <div className={styles.nameRow}>
          <h2 className={styles.name}>{contact.name ?? "Unnamed customer"}</h2>
          {contact.legalHoldAt ? (
            <span className={`${styles.chip} ${styles.chipHold}`}>On hold</span>
          ) : null}
          {erased ? <span className={`${styles.chip} ${styles.chipGone}`}>Erased</span> : null}
        </div>
        {erased ? (
          <p className={styles.muted}>
            Erased on {when(contact.anonymisedAt as string)}. Only the consent history and totals in
            reports remain.
          </p>
        ) : (
          <p className={styles.muted}>
            {contact.phoneE164}
            {contact.email ? ` · ${contact.email}` : ""}
          </p>
        )}
        {filesWaiting > 0 ? (
          <p className={styles.muted} role="status">
            {filesWaiting} file{filesWaiting === 1 ? " is" : "s are"} still waiting to be deleted
            from storage. We keep trying automatically.
          </p>
        ) : null}
        {actionError ? <Problem error={actionError} /> : null}
        {erased ? null : (
          <div className={styles.actions}>
            {can("privacy:export") ? (
              <a className={styles.button} href={`/api/privacy/contacts/${contactId}/export`}>
                Download their data
              </a>
            ) : null}
            {contact.legalHoldAt ? (
              <button type="button" className={styles.button} onClick={releaseHold}>
                Release hold
              </button>
            ) : (
              <button
                type="button"
                className={styles.button}
                onClick={() => setDialog({ kind: "hold" })}
              >
                Place a hold…
              </button>
            )}
            {can("privacy:erase") ? (
              <button
                type="button"
                className={`${styles.button} ${styles.danger}`}
                disabled={Boolean(contact.legalHoldAt) || openLeads.length > 0}
                onClick={() => setDialog({ kind: "erase" })}
              >
                Erase their data…
              </button>
            ) : null}
          </div>
        )}
        {!erased && can("privacy:erase") && contact.legalHoldAt ? (
          <p className={styles.muted}>Release the hold before erasing.</p>
        ) : null}
        {!erased && can("privacy:erase") && openLeads.length > 0 ? (
          <p className={styles.muted}>
            Close their open lead before erasing:{" "}
            {openLeads.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`}>
                Open the lead ({lead.stage.name})
              </Link>
            ))}
          </p>
        ) : null}
      </section>

      {erased ? null : (
        <section className={styles.card}>
          <h2>Consent</h2>
          {consents.map(({ purpose, label, canAllow, canWithdraw }) => (
            <div key={purpose} className={styles.consentRow}>
              <span className={styles.consentName}>
                {PURPOSES[purpose]}: {label}
              </span>
              {canAllow ? (
                <button
                  type="button"
                  className={styles.button}
                  aria-label={`Allow ${PURPOSES[purpose]}`}
                  onClick={() => setDialog({ kind: "consent", purpose, withdraw: false })}
                >
                  Allow…
                </button>
              ) : null}
              {canWithdraw ? (
                <button
                  type="button"
                  className={styles.button}
                  aria-label={`Withdraw ${PURPOSES[purpose]}`}
                  onClick={() => setDialog({ kind: "consent", purpose, withdraw: true })}
                >
                  Withdraw…
                </button>
              ) : null}
            </div>
          ))}
        </section>
      )}

      <section className={styles.card}>
        <h2>Consent history</h2>
        {contact.consents.length === 0 ? (
          <p className={styles.muted}>Nothing recorded yet.</p>
        ) : (
          <ul className={styles.list}>
            {contact.consents.map((consent) => (
              <li key={consent.id}>
                {when(consent.occurredAt)} · {PURPOSES[consent.purpose]}:{" "}
                {consent.status === "GRANTED" ? "allowed" : "withdrawn"} ·{" "}
                {SOURCES[consent.source] ?? consent.source} ·{" "}
                {consent.recordedBy ? consent.recordedBy.name : "Automatic"}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.kind === "consent" ? (
        <ConsentDialog
          contactId={contactId}
          purpose={dialog.purpose}
          withdraw={dialog.withdraw}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      ) : null}
      {dialog?.kind === "hold" ? (
        <HoldDialog contactId={contactId} onClose={() => setDialog(null)} onSaved={saved} />
      ) : null}
      {dialog?.kind === "erase" ? (
        <EraseDialog contact={contact} onClose={() => setDialog(null)} onSaved={saved} />
      ) : null}
    </>
  );
}

export function PrivacyPage() {
  const access = usePageAccess("privacy:manage");
  const router = useRouter();
  const params = useSearchParams();
  const contactId = params.get("contact");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ContactSummary[] | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);

  async function find(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest<{ contacts: ContactSummary[] }>(
      `/api/privacy/contacts?${new URLSearchParams({ search: search.trim() }).toString()}`,
    );
    if (result.ok) {
      setResults(result.data.contacts);
      setError(null);
    } else setError(result.error);
  }

  if (access === "loading") return <main className={styles.page}>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main className={styles.page}>
        <ErrorMessage error={access} />
      </main>
    );
  }
  return (
    <main className={styles.page}>
      <div>
        <h1 className={styles.title}>Customer privacy</h1>
        <p className={styles.muted}>
          Find a customer to see their consent, download their data or erase it.{" "}
          <Link href="/privacy-notice">Read the privacy notice</Link>
        </p>
      </div>
      <form className={styles.search} onSubmit={find}>
        <label className={`${styles.field} ${styles.grow}`}>
          Name, number or email
          <input
            className={styles.input}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button type="submit" className={`${styles.button} ${styles.primary}`}>
          Find
        </button>
      </form>
      {error ? <Problem error={error} /> : null}
      {results ? (
        results.length === 0 ? (
          <p className={styles.muted}>No customer matches that.</p>
        ) : (
          <div className={styles.results}>
            {results.map((contact) => (
              <button
                key={contact.id}
                type="button"
                className={styles.result}
                onClick={() => {
                  setResults(null);
                  router.replace(`/privacy?contact=${contact.id}`);
                }}
              >
                <b>{contact.name ?? "Unnamed customer"}</b>
                <span className={styles.muted}>{contact.phoneE164}</span>
              </button>
            ))}
          </div>
        )
      ) : null}
      {contactId ? <ContactPanel key={contactId} contactId={contactId} /> : null}
    </main>
  );
}
