"use client";

// This person's follow-ups, by bucket. The bucket is in the URL, so Back returns to it.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { FOLLOW_UP_BUCKETS, type FollowUpBucket } from "../leads.types";
import { dateLabel } from "./shared";
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

  async function toggle(item: FollowUp, completed: boolean) {
    const done = await apiRequest(`/api/leads/${item.lead.id}/tasks/${item.id}`, {
      method: "PATCH",
      body: { completed },
    });
    if (done.ok) setVersion((n) => n + 1);
    else setError(done.error);
  }

  const count = (key: FollowUpBucket) =>
    key === "overdue" || key === "today" || key === "upcoming" ? result?.counts[key] : undefined;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Follow-ups</h1>
      <div role="tablist" className={styles.pills}>
        {FOLLOW_UP_BUCKETS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={bucket === key}
            className={styles.pill}
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
      {result?.items.length === 0 ? <p className={styles.muted}>Nothing here.</p> : null}
      {result?.items.map((item) => (
        <div key={item.id} className={styles.taskRow}>
          <input
            type="checkbox"
            aria-label={`Mark done: ${item.title}`}
            checked={Boolean(item.completedAt)}
            disabled={!can("leads:edit")}
            onChange={(event) => toggle(item, event.target.checked)}
          />
          <span className={styles.taskBody}>
            <span className={item.completedAt ? styles.taskDone : ""}>{item.title}</span>
            <Link className={styles.when} href={`/leads/${item.lead.id}`}>
              {item.lead.contact.name ?? "Unnamed customer"} · {item.lead.stage.name}
            </Link>
          </span>
          <span className={item.overdue ? styles.overdue : styles.when}>
            {dateLabel(item.dueDate)}
          </span>
        </div>
      ))}
    </main>
  );
}
