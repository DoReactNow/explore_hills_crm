"use client";

// The call log. Missed calls are where Admins and managers follow up (Decision 61).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess } from "@/shared/rbac/usePrincipal";
import { formatInstant, parseInstant } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { RecordingState } from "./LeadCallPanel";
import { useSoftphone, type CallView } from "./SoftphoneProvider";
import styles from "./telephony.module.css";

export function CallsPage() {
  const access = usePageAccess("telephony:call");
  const router = useRouter();
  const filter = useSearchParams().get("filter") === "missed" ? "missed" : "all";
  const { version } = useSoftphone();
  const [items, setItems] = useState<CallView[] | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    apiRequest<{ items: CallView[] }>(`/api/telephony/calls?filter=${filter}`, {
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setItems(result.data.items);
      else setError(result.error);
    });
    return () => controller.abort();
  }, [access, filter, version]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Calls</h1>
        <ErrorMessage error={access} />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Calls</h1>
      <div className={styles.pills}>
        <button
          type="button"
          className={styles.pill}
          aria-pressed={filter === "all"}
          onClick={() => router.replace("/calls", { scroll: false })}
        >
          All
        </button>
        <button
          type="button"
          className={styles.pill}
          aria-pressed={filter === "missed"}
          onClick={() => router.replace("/calls?filter=missed", { scroll: false })}
        >
          Missed
        </button>
      </div>
      {error ? <ErrorMessage error={error} /> : null}
      {items?.length === 0 ? <p className={styles.muted}>No calls here yet.</p> : null}
      {items?.map((call) => (
        <div key={call.id} className={styles.row}>
          {call.leadId ? (
            <Link href={`/leads/${call.leadId}`}>{call.customerName ?? "Unnamed customer"}</Link>
          ) : (
            <span>{call.hidden ? "Hidden number" : call.customerPhoneE164}</span>
          )}
          <span
            className={
              !call.answeredAt && call.direction === "INBOUND" ? styles.missed : styles.muted
            }
          >
            {call.direction === "INBOUND" ? (call.answeredAt ? "Incoming" : "Missed") : "Outgoing"}
          </span>
          <span className={styles.muted}>{call.agent?.name ?? "Nobody"}</span>
          <span className={`${styles.muted} ${styles.right}`}>
            {formatInstant(parseInstant(call.startedAt), "dateTime")}
          </span>
          <RecordingState call={call} />
        </div>
      ))}
    </main>
  );
}
