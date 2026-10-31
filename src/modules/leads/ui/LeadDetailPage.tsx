"use client";

// One lead: stage, trip details, follow-ups, notes and the timeline. Chat and calling join this page
// in Phases 4 to 7.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { useShortcuts } from "@/shared/ui/useShortcuts";
import { useUnsavedWarning } from "@/shared/ui/useUnsavedWarning";
import { LOST_REASONS, SOURCE_LABELS, type LeadSource } from "../leads.types";
import {
  Field,
  FormError,
  OwnerLabel,
  StageChip,
  budgetLabel,
  dateLabel,
  dueClass,
  fieldMessage,
  instantLabel,
  phoneLabel,
  tripDates,
  type LeadRow,
  type StageOption,
} from "./shared";
import styles from "./leads.module.css";

const VIEW_LEADS = ["leads:view-own", "leads:view-team", "leads:view-all"] as const;

interface Person {
  id: string;
  name: string;
  status: string;
}
interface LeadDetail extends LeadRow {
  notes: Array<{ id: string; body: string; createdAt: string; author: Person }>;
  tasks: Array<{
    id: string;
    title: string;
    dueDate: string;
    completedAt: string | null;
    assignee: Person;
  }>;
  timeline: Array<{
    id: string;
    kind: string;
    summary: string;
    occurredAt: string;
    actor: Person | null;
  }>;
  otherLeads: LeadRow[];
}

function EditTripDialog({
  lead,
  onClose,
  onSaved,
}: {
  lead: LeadDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    customerName: lead.contact.name ?? "",
    destination: lead.destination ?? "",
    travelStartDate: lead.travelStartDate ?? "",
    travelEndDate: lead.travelEndDate ?? "",
    travellerCount: lead.travellerCount?.toString() ?? "",
    budgetAmount: lead.budgetAmount ?? "",
    stay: lead.customFields.stay ?? "",
    language: lead.customFields.language ?? "",
  });
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const count = form.travellerCount.trim();
    const result = await apiRequest(`/api/leads/${lead.id}`, {
      method: "PATCH",
      body: {
        version: lead.version,
        customerName: form.customerName,
        destination: form.destination || null,
        travelStartDate: form.travelStartDate || null,
        travelEndDate: form.travelEndDate || null,
        travellerCount: count ? Number(count) : null,
        budgetAmount: form.budgetAmount.replace(/[,\s]/g, "") || null,
        customFields: { stay: form.stay, language: form.language },
      },
    });
    setBusy(false);
    if (result.ok) onSaved();
    else setError(result.error);
  }

  return (
    <Dialog title="Edit trip details" onClose={onClose}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <FormError
          error={error}
          fields={[
            "customerName",
            "destination",
            "travelStartDate",
            "travelEndDate",
            "travellerCount",
            "budgetAmount",
          ]}
        />
        <div className={styles.grid}>
          <Field id="et-name" label="Customer name" error={fieldMessage(error, "customerName")}>
            <input
              id="et-name"
              className={styles.control}
              value={form.customerName}
              onChange={set("customerName")}
            />
          </Field>
          <Field id="et-dest" label="Destination" error={fieldMessage(error, "destination")}>
            <input
              id="et-dest"
              className={styles.control}
              value={form.destination}
              onChange={set("destination")}
            />
          </Field>
          <Field id="et-start" label="Travel from" error={fieldMessage(error, "travelStartDate")}>
            <input
              id="et-start"
              type="date"
              className={styles.control}
              value={form.travelStartDate}
              onChange={set("travelStartDate")}
            />
          </Field>
          <Field id="et-end" label="Travel to" error={fieldMessage(error, "travelEndDate")}>
            <input
              id="et-end"
              type="date"
              className={styles.control}
              value={form.travelEndDate}
              onChange={set("travelEndDate")}
            />
          </Field>
          <Field id="et-count" label="Travellers" error={fieldMessage(error, "travellerCount")}>
            <input
              id="et-count"
              inputMode="numeric"
              className={styles.control}
              value={form.travellerCount}
              onChange={set("travellerCount")}
            />
          </Field>
          <Field id="et-budget" label="Budget (₹)" error={fieldMessage(error, "budgetAmount")}>
            <input
              id="et-budget"
              inputMode="decimal"
              className={styles.control}
              value={form.budgetAmount}
              onChange={set("budgetAmount")}
            />
          </Field>
          <Field id="et-stay" label="Stay">
            <input
              id="et-stay"
              className={styles.control}
              value={form.stay}
              onChange={set("stay")}
            />
          </Field>
          <Field id="et-lang" label="Language">
            <input
              id="et-lang"
              className={styles.control}
              value={form.language}
              onChange={set("language")}
            />
          </Field>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LostDialog({
  lead,
  stageCode,
  onClose,
  onSaved,
}: {
  lead: LeadDetail;
  stageCode: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const lostReason = extra.trim() ? `${reason}: ${extra.trim()}` : reason;
    const result = await apiRequest(`/api/leads/${lead.id}/stage`, {
      method: "POST",
      body: { stageCode, lostReason: reason ? lostReason : null },
    });
    if (result.ok) onSaved();
    else setError(result.error);
  }
  return (
    <Dialog title={`Move ${lead.contact.name ?? "this lead"} to Lost?`} onClose={onClose}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <p className={styles.dialogText}>
          Pick the main reason. This helps us price better next season.
        </p>
        <FormError error={error} fields={["lostReason"]} />
        <fieldset
          style={{
            border: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <legend className={styles.fieldHint}>Reason</legend>
          {LOST_REASONS.map((item) => (
            <label key={item} className={styles.choice}>
              <input
                type="radio"
                name="lost-reason"
                checked={reason === item}
                onChange={() => setReason(item)}
              />
              {item}
            </label>
          ))}
          {fieldMessage(error, "lostReason") ? (
            <span className={styles.fieldError}>{fieldMessage(error, "lostReason")}</span>
          ) : null}
        </fieldset>
        <div className={styles.field}>
          <label htmlFor="lost-extra">Anything to add? (optional)</label>
          <textarea
            id="lost-extra"
            className={styles.textarea}
            value={extra}
            onChange={(event) => setExtra(event.target.value)}
          />
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.dangerSolid}`}>
            Move to Lost
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const LEAD_NOTICES = ["assignment.leadOwnerChanged", "leads.leadChanged"];

function ReassignDialog({
  leadId,
  currentOwnerId,
  onClose,
  onDone,
}: {
  leadId: string;
  currentOwnerId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [agents, setAgents] = useState<
    Array<{ id: string; name: string; openLeads: number; cap: number }>
  >([]);
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: typeof agents }>("/api/assignment/agents", {
      signal: controller.signal,
    }).then((result) => {
      if (result.ok) setAgents(result.data.items.filter((agent) => agent.id !== currentOwnerId));
      else if (!controller.signal.aborted) setError(result.error);
    });
    return () => controller.abort();
  }, [currentOwnerId]);

  async function reassign(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest(`/api/leads/${leadId}/reassign`, {
      method: "POST",
      body: { toUserId, reason },
    });
    if (result.ok) onDone();
    else setError(result.error);
  }

  return (
    <Dialog title="Reassign this lead" onClose={onClose}>
      <form onSubmit={reassign} className={styles.form} noValidate>
        <p className={styles.dialogText}>
          Its open follow-ups and chat move to the new owner, and the customer sees no change.
        </p>
        <FormError error={error} fields={["toUserId", "reason"]} />
        <Field id="reassign-to" label="New owner">
          <select
            id="reassign-to"
            className={styles.control}
            value={toUserId}
            onChange={(event) => setToUserId(event.target.value)}
          >
            <option value="">Choose…</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · {agent.openLeads} of {agent.cap} open
              </option>
            ))}
          </select>
        </Field>
        <Field id="reassign-reason" label="Reason">
          <input
            id="reassign-reason"
            className={styles.control}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={`${styles.button} ${styles.primary}`}
            disabled={!toUserId || !reason.trim()}
          >
            Reassign
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MergeDialog({
  leadId,
  onClose,
  onMerged,
}: {
  leadId: string;
  onClose: () => void;
  onMerged: (target: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<LeadRow[]>([]);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);

  useEffect(() => {
    if (search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiRequest<{ items: LeadRow[] }>(
        `/api/leads?pageSize=10&search=${encodeURIComponent(search)}`,
        {
          signal: controller.signal,
        },
      ).then((result) => {
        if (result.ok) setMatches(result.data.items.filter((item) => item.id !== leadId));
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, leadId]);

  async function merge(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest(`/api/leads/${leadId}/merge`, {
      method: "POST",
      body: { intoLeadId: target },
    });
    if (result.ok) onMerged(target);
    else setError(result.error);
  }

  return (
    <Dialog title="Merge into another lead" onClose={onClose}>
      <form onSubmit={merge} className={styles.form} noValidate>
        <p className={styles.dialogText}>
          Its notes, follow-ups, chats and history move to the lead you choose, and this one
          disappears from lists.
        </p>
        <FormError error={error} fields={["intoLeadId"]} />
        <Field id="merge-search" label="Find the other lead" hint="Name or phone">
          <input
            id="merge-search"
            className={styles.control}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        {matches.map((item) => (
          <label key={item.id} className={styles.choice}>
            <input
              type="radio"
              name="merge-target"
              checked={target === item.id}
              onChange={() => setTarget(item.id)}
            />
            {item.contact.name ?? "Unnamed customer"} · {phoneLabel(item.contact.phoneE164)} ·{" "}
            {item.stage.name}
          </label>
        ))}
        {fieldMessage(error, "intoLeadId") ? (
          <span className={styles.fieldError}>{fieldMessage(error, "intoLeadId")}</span>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={!target}>
            Merge
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function LeadDetailPage({ id, chat }: { id: string; chat?: ReactNode }) {
  const access = usePageAccess(VIEW_LEADS);
  const { can } = usePrincipal();
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [tab, setTab] = useState<"activity" | "notes" | "tasks">("activity");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<FriendlyError | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskError, setTaskError] = useState<FriendlyError | null>(null);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [dialog, setDialog] = useState<"edit" | "lost" | "delete" | "merge" | "reassign" | null>(
    null,
  );

  const [gone, setGone] = useState(false);
  const [ownerNotice, setOwnerNotice] = useState("");
  const [view, setView] = useState<"chat" | "details" | "activity">("chat");
  const loaded = useRef(false);
  const lastOwner = useRef<string | null | undefined>(undefined);

  const reload = useCallback(async () => {
    const result = await apiRequest<LeadDetail>(`/api/leads/${id}`);
    if (result.ok) {
      const owner = result.data.owner;
      if (lastOwner.current !== undefined && lastOwner.current !== (owner?.id ?? null)) {
        setOwnerNotice(
          owner ? `This lead is now with ${owner.name}.` : "This lead is back in the queue.",
        );
      }
      lastOwner.current = owner?.id ?? null;
      loaded.current = true;
      setLead(result.data);
      setLoadError(null);
      setGone(false);
    } else if (loaded.current && result.error.code === "NOT_FOUND") {
      // Keep the screen, and whatever is being typed, but stop allowing edits (P6-WORK-02).
      setGone(true);
    } else setLoadError(result.error);
  }, [id]);

  useUnsavedWarning(note.trim().length > 0 || taskTitle.trim().length > 0);
  useShortcuts({
    n: () => {
      setView("activity");
      setTab("activity");
      setTimeout(() => document.getElementById("lead-note")?.focus(), 0);
    },
    f: () => {
      setView("activity");
      setTab("tasks");
      setTimeout(() => document.getElementById("lead-task")?.focus(), 0);
    },
  });

  // A new owner shows at once, and someone who has just lost the lead loses this screen too.
  useLiveEvents({
    types: LEAD_NOTICES,
    onEvent: (_type, payload) => {
      if ((payload as { leadId?: string }).leadId === id) reload();
    },
    onResync: reload,
  });

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    apiRequest<LeadDetail>(`/api/leads/${id}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        loaded.current = true;
        lastOwner.current = result.data.owner?.id ?? null;
        setLead(result.data);
      } else setLoadError(result.error);
    });
    apiRequest<StageOption[]>("/api/leads/stages", { signal: controller.signal }).then((result) => {
      if (result.ok) setStages(result.data);
    });
    return () => controller.abort();
  }, [access, id]);

  if (access === "loading") return <main>Loading…</main>;
  const refusal = access !== "allowed" ? access : loadError;
  if (refusal) {
    return (
      <main>
        <h1 className={styles.title}>Lead</h1>
        <ErrorMessage error={refusal} />
      </main>
    );
  }
  if (!lead) return <main aria-busy="true">Loading…</main>;

  const canEdit = can("leads:edit");
  const editable = canEdit && !gone;
  const lostStage = stages.find((stage) => stage.kind === "LOST" && stage.isActive);
  const pipeline = stages.filter(
    (stage) => stage.kind !== "LOST" && (stage.isActive || stage.code === lead.stage.code),
  );
  const name = lead.contact.name ?? "Unnamed customer";

  async function move(stageCode: string) {
    const result = await apiRequest(`/api/leads/${id}/stage`, {
      method: "POST",
      body: { stageCode },
    });
    if (result.ok) {
      setActionError(null);
      await reload();
    } else setActionError(result.error);
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest(`/api/leads/${id}/notes`, {
      method: "POST",
      body: { body: note },
    });
    if (result.ok) {
      setNote("");
      setNoteError(null);
      await reload();
    } else setNoteError(result.error);
  }

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    const result = await apiRequest(`/api/leads/${id}/tasks`, {
      method: "POST",
      body: { title: taskTitle, dueDate: taskDue },
    });
    if (result.ok) {
      setTaskTitle("");
      setTaskDue("");
      setTaskError(null);
      await reload();
    } else setTaskError(result.error);
  }

  async function toggleTask(taskId: string, completed: boolean) {
    const result = await apiRequest(`/api/leads/${id}/tasks/${taskId}`, {
      method: "PATCH",
      body: { completed },
    });
    if (result.ok) await reload();
    else setActionError(result.error);
  }

  async function openChat() {
    const result = await apiRequest<{ id: string }>(`/api/leads/${id}/conversation`, {
      method: "POST",
    });
    if (result.ok) router.push(`/inbox?c=${result.data.id}`);
    else setActionError(result.error);
  }

  async function remove() {
    const result = await apiRequest(`/api/leads/${id}`, { method: "DELETE" });
    if (result.ok) router.push("/leads");
    else {
      setDialog(null);
      setActionError(result.error);
    }
  }

  const composer = canEdit ? (
    <form onSubmit={submitNote} className={styles.composer} noValidate>
      <input
        id="lead-note"
        aria-label="Add a note"
        placeholder="Add a note. Only staff can see it."
        className={styles.control}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button type="submit" className={styles.button} disabled={gone}>
        Add note
      </button>
      {fieldMessage(noteError, "body") ? (
        <span className={styles.fieldError}>{fieldMessage(noteError, "body")}</span>
      ) : null}
    </form>
  ) : null;

  return (
    <main className={styles.page}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <Link href="/leads">Leads</Link> / <span>{name}</span>
      </nav>
      <div className={styles.leadHead}>
        <div className={styles.leadName}>
          <div className={styles.nameLine}>
            <h1>{name}</h1>
            <StageChip code={lead.stage.code} name={lead.stage.name} />
          </div>
          <span className={styles.muted}>
            {phoneLabel(lead.contact.phoneE164)} · {lead.destination ?? "No destination yet"} ·{" "}
            {tripDates(lead)}
          </span>
        </div>
        {can("messaging:view") && !gone ? (
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={openChat}>
            Open chat
          </button>
        ) : null}
        {can("leads:reassign") && lead.closedAt === null && !gone ? (
          <button type="button" className={styles.button} onClick={() => setDialog("reassign")}>
            Reassign…
          </button>
        ) : null}
        {can("leads:merge") && !gone ? (
          <button type="button" className={styles.button} onClick={() => setDialog("merge")}>
            Merge…
          </button>
        ) : null}
        {can("leads:delete") && !gone ? (
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            onClick={() => setDialog("delete")}
          >
            Delete
          </button>
        ) : null}
      </div>
      <FormError error={actionError} />
      {gone ? (
        <div role="alert" className={styles.notice}>
          <b>This lead has moved and is no longer yours.</b> You can&apos;t change it any more.
          Anything you were typing is still here to copy.{" "}
          <Link href="/leads">Back to your leads</Link>
        </div>
      ) : ownerNotice ? (
        <div role="status" className={styles.notice}>
          {ownerNotice}
        </div>
      ) : null}

      <div role="tablist" aria-label="Lead sections" className={styles.viewTabs}>
        {(["chat", "details", "activity"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={styles.viewTab}
            onClick={() => setView(key)}
          >
            {key === "chat" ? "Chat" : key === "details" ? "Details" : "Activity"}
          </button>
        ))}
      </div>

      {/* The softphone panel and live call card go here in Phase 7. */}
      <div className={`${styles.panes} ${chat ? styles.panesWithChat : ""}`} data-view={view}>
        <aside aria-label="Customer and trip" className={`${styles.side} ${styles.viewDetails}`}>
          <section className={styles.card}>
            <div className={styles.cardHead}>Stage</div>
            {pipeline.map((stage) => (
              <button
                key={stage.code}
                type="button"
                className={styles.stageButton}
                aria-current={stage.code === lead.stage.code ? "step" : undefined}
                disabled={!editable}
                onClick={() => move(stage.code)}
              >
                {stage.name}
              </button>
            ))}
            {editable && lostStage && lead.stage.kind !== "LOST" ? (
              <button
                type="button"
                className={`${styles.button} ${styles.danger}`}
                onClick={() => setDialog("lost")}
              >
                Mark as Lost…
              </button>
            ) : null}
            {lead.stage.kind === "LOST" ? (
              <span className={styles.muted}>Lost: {lead.lostReason}</span>
            ) : null}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              Trip details
              {editable ? (
                <button type="button" className={styles.button} onClick={() => setDialog("edit")}>
                  Edit
                </button>
              ) : null}
            </div>
            <dl className={styles.facts}>
              <dt>Destination</dt>
              <dd>{lead.destination ?? "—"}</dd>
              <dt>Dates</dt>
              <dd>{tripDates(lead)}</dd>
              <dt>Travellers</dt>
              <dd>{lead.travellerCount ?? "—"}</dd>
              <dt>Budget</dt>
              <dd>{budgetLabel(lead.budgetAmount)}</dd>
              <dt>Source</dt>
              <dd>
                {SOURCE_LABELS[lead.source as LeadSource] ?? lead.source} ·{" "}
                {instantLabel(lead.createdAt)}
              </dd>
              {lead.customFields.stay ? (
                <>
                  <dt>Stay</dt>
                  <dd>{lead.customFields.stay}</dd>
                </>
              ) : null}
              {lead.customFields.language ? (
                <>
                  <dt>Language</dt>
                  <dd>{lead.customFields.language}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>Owner &amp; follow-up</div>
            <div>
              <OwnerLabel owner={lead.owner} />
            </div>
            <span className={dueClass(lead.nextFollowUpDate)}>
              Next follow-up: {dateLabel(lead.nextFollowUpDate)}
            </span>
          </section>

          {lead.otherLeads.length > 0 ? (
            <section className={styles.card}>
              <div className={styles.cardHead}>Other trips</div>
              {lead.otherLeads.map((other) => (
                <Link key={other.id} href={`/leads/${other.id}`} className={styles.rowLink}>
                  {other.destination ?? "No destination"} · {other.stage.name} ·{" "}
                  {instantLabel(other.createdAt)}
                </Link>
              ))}
            </section>
          ) : null}
        </aside>

        <section aria-label="Activity" className={`${styles.card} ${styles.viewActivity}`}>
          <div role="tablist" className={styles.tabs}>
            {(
              [
                ["activity", "All activity"],
                ["notes", `Notes ${lead.notes.length}`],
                ["tasks", `Follow-ups ${lead.tasks.filter((task) => !task.completedAt).length}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={styles.tab}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "activity" ? (
            <>
              {composer}
              <ol className={styles.timeline}>
                {lead.timeline.map((entry) => (
                  <li key={entry.id} className={styles.timelineItem}>
                    <span>{entry.summary}</span>
                    <span className={styles.when}>
                      {entry.actor?.name ?? "System"} · {instantLabel(entry.occurredAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          {tab === "notes" ? (
            <>
              {composer}
              {lead.notes.length === 0 ? <p className={styles.muted}>No notes yet.</p> : null}
              {lead.notes.map((item) => (
                <div key={item.id} className={styles.note}>
                  {item.body}
                  <div className={styles.when}>
                    {item.author.name} · {instantLabel(item.createdAt)}
                  </div>
                </div>
              ))}
            </>
          ) : null}

          {tab === "tasks" ? (
            <>
              {editable ? (
                <form onSubmit={submitTask} className={styles.composer} noValidate>
                  <input
                    id="lead-task"
                    aria-label="Follow-up"
                    placeholder="What needs doing?"
                    className={styles.control}
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                  />
                  <input
                    aria-label="Due date"
                    type="date"
                    className={styles.control}
                    style={{ flex: "0 0 auto" }}
                    value={taskDue}
                    onChange={(event) => setTaskDue(event.target.value)}
                  />
                  <button type="submit" className={styles.button}>
                    Add follow-up
                  </button>
                  {fieldMessage(taskError, "title") ? (
                    <span className={styles.fieldError}>{fieldMessage(taskError, "title")}</span>
                  ) : null}
                  {fieldMessage(taskError, "dueDate") ? (
                    <span className={styles.fieldError}>{fieldMessage(taskError, "dueDate")}</span>
                  ) : null}
                </form>
              ) : null}
              {lead.tasks.length === 0 ? <p className={styles.muted}>No follow-ups yet.</p> : null}
              {lead.tasks.map((task) => (
                <div key={task.id} className={styles.taskRow}>
                  <input
                    type="checkbox"
                    aria-label={`Mark done: ${task.title}`}
                    checked={Boolean(task.completedAt)}
                    disabled={!editable}
                    onChange={(event) => toggleTask(task.id, event.target.checked)}
                  />
                  <span className={styles.taskBody}>
                    <span className={task.completedAt ? styles.taskDone : ""}>{task.title}</span>
                    <span
                      className={`${styles.when} ${task.completedAt ? "" : dueClass(task.dueDate)}`}
                    >
                      {dateLabel(task.dueDate)} · {task.assignee.name}
                    </span>
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </section>
        {chat && !gone ? <div className={styles.viewChat}>{chat}</div> : null}
      </div>

      {dialog === "edit" ? (
        <EditTripDialog
          lead={lead}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await reload();
          }}
        />
      ) : null}
      {dialog === "lost" && lostStage ? (
        <LostDialog
          lead={lead}
          stageCode={lostStage.code}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await reload();
          }}
        />
      ) : null}
      {dialog === "reassign" ? (
        <ReassignDialog
          leadId={id}
          currentOwnerId={lead.owner?.id ?? null}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await reload();
          }}
        />
      ) : null}
      {dialog === "merge" ? (
        <MergeDialog
          leadId={id}
          onClose={() => setDialog(null)}
          onMerged={(target) => router.push(`/leads/${target}`)}
        />
      ) : null}
      {dialog === "delete" ? (
        <Dialog title={`Delete this lead for ${name}?`} onClose={() => setDialog(null)}>
          <p className={styles.dialogText}>
            It will disappear from every list. Its history is kept.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.dangerSolid}`}
              onClick={remove}
            >
              Delete lead
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
