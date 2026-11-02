"use client";

// This person's follow-ups (FollowUps-Desktop and FollowUps-Mobile designs), grouped into overdue,
// today and upcoming. The bucket is in the URL, so Back returns to it.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import {
  addBusinessDays,
  businessWeekday,
  systemClock,
  todayBusinessDate,
  type BusinessDate,
} from "@/shared/time";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { Icon } from "@/shared/ui/Icon";
import { toastError, toastSuccess } from "@/shared/ui/toast";
import { FOLLOW_UP_BUCKETS, type FollowUpBucket } from "../leads.types";
import { Field, FormError, dateLabel, type LeadRow } from "./shared";
import styles from "./leads.module.css";

const VIEW_LEADS = ["leads:view-own", "leads:view-team", "leads:view-all"] as const;
const LABELS: Record<FollowUpBucket, string> = {
  open: "All open",
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  completed: "Completed",
};

interface FollowUp {
  id: string;
  title: string;
  dueDate: string;
  completedAt: string | null;
  overdue: boolean;
  lead: {
    id: string;
    destination: string | null;
    contact: { name: string | null };
    stage: { name: string };
  };
}
interface Result {
  items: FollowUp[];
  counts: { overdue: number; today: number; upcoming: number };
}

function snoozeChoices(today: BusinessDate) {
  const weekday = businessWeekday(today); // 0 = Sunday … 6 = Saturday
  return [
    { label: "Tomorrow", date: addBusinessDays(today, 1) },
    { label: "In 3 days", date: addBusinessDays(today, 3) },
    { label: "Next Monday", date: addBusinessDays(today, (8 - weekday) % 7 || 7) },
  ];
}

function SnoozeMenu({ onPick }: { onPick: (date: BusinessDate) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const today = todayBusinessDate(systemClock);
  return (
    <div className={styles.moreWrap} ref={wrap}>
      <button
        type="button"
        className={styles.snooze}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        Snooze
      </button>
      {open ? (
        <div role="menu" className={styles.menu}>
          {snoozeChoices(today).map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onPick(choice.date);
              }}
            >
              {choice.label} · {dateLabel(choice.date)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddFollowUpDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<LeadRow[]>([]);
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(todayBusinessDate(systemClock));
  const [error, setError] = useState<FriendlyError | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (lead || term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiRequest<{ items: LeadRow[] }>(
        `/api/leads?search=${encodeURIComponent(term)}&pageSize=6&quick=open`,
        { signal: controller.signal },
      ).then((result) => {
        if (result.ok) setMatches(result.data.items);
      });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, lead]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!lead) return;
    const result = await apiRequest(`/api/leads/${lead.id}/tasks`, {
      method: "POST",
      body: { title, dueDate },
    });
    if (result.ok) onSaved();
    else setError(result.error);
  }

  return (
    <Dialog title="Add a follow-up" onClose={onClose}>
      <form onSubmit={submit} className={styles.form} noValidate>
        <FormError error={error} fields={["title", "dueDate"]} />
        <Field id="fu-lead" label="Lead">
          {lead ? (
            <span className={styles.pickedLead}>
              {lead.contact.name ?? "Unnamed customer"}
              {lead.destination ? ` · ${lead.destination}` : ""}
              <button type="button" className={styles.linkAction} onClick={() => setLead(null)}>
                Change
              </button>
            </span>
          ) : (
            <>
              <input
                id="fu-lead"
                className={styles.control}
                placeholder="Search name or phone"
                value={query}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
              {matches.length > 0 ? (
                <div className={styles.matchList}>
                  {matches.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      className={styles.menuItem}
                      onClick={() => setLead(match)}
                    >
                      {match.contact.name ?? "Unnamed customer"}
                      {match.destination ? ` · ${match.destination}` : ""}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Field>
        <Field id="fu-title" label="What needs doing">
          <input
            id="fu-title"
            className={styles.control}
            maxLength={300}
            value={title}
            placeholder="Call back about dates"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field id="fu-due" label="Due">
          <input
            id="fu-due"
            type="date"
            className={styles.control}
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={`${styles.button} ${styles.primary}`}
            disabled={!lead || !title.trim() || !dueDate}
          >
            Add follow-up
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function FollowUpsPage() {
  const access = usePageAccess(VIEW_LEADS);
  const { can } = usePrincipal();
  const router = useRouter();
  const raw = useSearchParams().get("bucket");
  const bucket: FollowUpBucket = FOLLOW_UP_BUCKETS.includes(raw as FollowUpBucket)
    ? (raw as FollowUpBucket)
    : "open";
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    apiRequest<Result>(`/api/follow-ups?bucket=${bucket}`, { signal: controller.signal }).then(
      (next) => {
        if (controller.signal.aborted) return;
        if (next.ok) setResult(next.data);
        else setError(next.error);
      },
    );
    return () => controller.abort();
  }, [access, bucket, version]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed" || error) {
    return (
      <main>
        <h1 className={styles.title}>Follow-ups</h1>
        <ErrorMessage error={(access !== "allowed" ? access : error) as FriendlyError} />
      </main>
    );
  }

  const editable = can("leads:edit");

  async function change(item: FollowUp, body: { completed: boolean } | { dueDate: string }) {
    const done = await apiRequest(`/api/leads/${item.lead.id}/tasks/${item.id}`, {
      method: "PATCH",
      body,
    });
    if (done.ok) {
      if ("dueDate" in body) toastSuccess(`Moved to ${dateLabel(body.dueDate)}.`);
      setVersion((n) => n + 1);
    } else toastError(done.error);
  }

  const count = (key: FollowUpBucket) =>
    key === "overdue" || key === "today" || key === "upcoming" ? result?.counts[key] : undefined;
  const today = todayBusinessDate(systemClock);
  const items = result?.items ?? [];
  const groups =
    bucket === "open"
      ? [
          { key: "overdue", label: "Overdue", rows: items.filter((item) => item.dueDate < today) },
          { key: "today", label: "Today", rows: items.filter((item) => item.dueDate === today) },
          {
            key: "upcoming",
            label: "Upcoming",
            rows: items.filter((item) => item.dueDate > today),
          },
        ]
      : [{ key: bucket, label: "", rows: items }];

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Follow-ups</h1>
        {editable ? (
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={18} strokeWidth={2} />
            Add follow-up
          </button>
        ) : null}
      </div>
      <div role="tablist" className={styles.pills}>
        {FOLLOW_UP_BUCKETS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={bucket === key}
            className={`${styles.pill} ${key === "overdue" ? styles.pillDanger : key === "today" ? styles.pillWarning : ""}`}
            onClick={() =>
              router.replace(key === "open" ? "/follow-ups" : `/follow-ups?bucket=${key}`, {
                scroll: false,
              })
            }
          >
            {LABELS[key]}
            {count(key) !== undefined ? ` · ${count(key)}` : ""}
          </button>
        ))}
      </div>
      {!result ? <p aria-busy="true">Loading…</p> : null}
      {result && items.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>All caught up</span>
          <span className={styles.muted}>Nothing to follow up here.</span>
        </div>
      ) : null}
      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <section
            key={group.key}
            className={styles.fuGroup}
            aria-label={group.label || LABELS[bucket]}
          >
            {group.label ? (
              <h2
                className={`${styles.fuHeading} ${group.key === "overdue" ? styles.overdue : ""}`}
              >
                {group.label}
              </h2>
            ) : null}
            <ul className={styles.fuList}>
              {group.rows.map((item) => {
                const name = item.lead.contact.name ?? "Unnamed customer";
                return (
                  <li
                    key={item.id}
                    className={item.completedAt ? `${styles.fuRow} ${styles.fuDone}` : styles.fuRow}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Mark done: ${item.title}`}
                      checked={Boolean(item.completedAt)}
                      disabled={!editable}
                      onChange={(event) => change(item, { completed: event.target.checked })}
                    />
                    <span
                      className={`${styles.fuDate} ${item.dueDate < today && !item.completedAt ? styles.overdue : ""}`}
                    >
                      {item.dueDate === today ? "Today" : dateLabel(item.dueDate)}
                    </span>
                    <span className={styles.fuText}>
                      <span className={item.completedAt ? styles.taskDone : styles.fuTitle}>
                        {item.title}
                      </span>
                      <Link className={styles.fuLead} href={`/leads/${item.lead.id}`}>
                        {name} · {item.lead.stage.name}
                      </Link>
                    </span>
                    {item.completedAt ? (
                      <span className={styles.muted}>Done</span>
                    ) : (
                      <span className={styles.fuActions}>
                        <Link
                          href={`/leads/${item.lead.id}`}
                          className={`${styles.fuIcon} ${styles.fuCall}`}
                          aria-label={`Open ${name} to call`}
                          title="Call"
                        >
                          <Icon name="calls" size={16} />
                        </Link>
                        <Link
                          href={`/leads/${item.lead.id}`}
                          className={styles.fuIcon}
                          aria-label={`Open ${name} to message`}
                          title="WhatsApp"
                        >
                          <Icon name="inbox" size={16} />
                        </Link>
                        {editable ? (
                          <SnoozeMenu onPick={(date) => change(item, { dueDate: date })} />
                        ) : null}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
      {adding ? (
        <AddFollowUpDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            toastSuccess("Follow-up added.");
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
    </main>
  );
}
