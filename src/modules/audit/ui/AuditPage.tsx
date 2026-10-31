"use client";

// The audit trail: read only, so it offers no edit or delete (P10-AUDV-03). Filters live in the URL, so
// Back returns to them and a filtered view can be shared.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { formatInstant, parseInstant } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "./audit.module.css";

interface Person {
  id: string;
  name: string;
  status: string;
}
interface AuditEvent {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  actor: Person | null;
}
interface Options {
  actors: Person[];
  actions: string[];
  includesSystem: boolean;
}

type FilterKey = "actorId" | "action" | "from" | "to" | "search";

const actionLabel = (action: string) => {
  const [area, what] = action.split(".");
  const name = `${area} · ${what.replaceAll("_", " ")}`;
  return name[0].toUpperCase() + name.slice(1);
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

export function AuditPage() {
  const access = usePageAccess("audit:view");
  const { can } = usePrincipal();
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const [options, setOptions] = useState<Options | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");

  useEffect(() => {
    if (access !== "allowed") return;
    let live = true;
    void apiRequest<Options>("/api/audit/options").then((result) => {
      if (live && result.ok) setOptions(result.data);
    });
    return () => {
      live = false;
    };
  }, [access]);

  useEffect(() => {
    if (access !== "allowed") return;
    let live = true;
    void apiRequest<{ events: AuditEvent[]; nextAfter: string | null }>(
      `/api/audit${query ? `?${query}` : ""}`,
    ).then((result) => {
      if (!live) return;
      if (result.ok) {
        setEvents(result.data.events);
        setNextAfter(result.data.nextAfter);
        setError(null);
      } else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [access, query]);

  function setFilter(key: FilterKey, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if ((params.get(key) ?? "") === value) return;
    router.replace(`/audit${next.size ? `?${next.toString()}` : ""}`);
  }

  async function loadMore() {
    if (!nextAfter) return;
    const next = new URLSearchParams(params.toString());
    next.set("after", nextAfter);
    const result = await apiRequest<{ events: AuditEvent[]; nextAfter: string | null }>(
      `/api/audit?${next.toString()}`,
    );
    if (result.ok) {
      setEvents((current) => [...(current ?? []), ...result.data.events]);
      setNextAfter(result.data.nextAfter);
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
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>Audit trail</h1>
          <span className={styles.muted}>
            Read only · every change made in the CRM, kept for good
          </span>
        </div>
        {can("audit:export") ? (
          <a className={styles.button} href={`/api/audit/export${query ? `?${query}` : ""}`}>
            Export
          </a>
        ) : null}
      </div>
      <div className={styles.filters}>
        <label className={styles.field}>
          Who
          <select
            className={styles.input}
            value={params.get("actorId") ?? ""}
            onChange={(event) => setFilter("actorId", event.target.value)}
          >
            <option value="">Anyone</option>
            {options?.includesSystem ? <option value="system">System</option> : null}
            {options?.actors.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.status === "ACTIVE" ? "" : " (deactivated)"}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          What
          <select
            className={styles.input}
            value={params.get("action") ?? ""}
            onChange={(event) => setFilter("action", event.target.value)}
          >
            <option value="">Everything</option>
            {options?.actions.map((action) => (
              <option key={action} value={action}>
                {actionLabel(action)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          From
          <input
            type="date"
            className={styles.input}
            value={params.get("from") ?? ""}
            onChange={(event) => setFilter("from", event.target.value)}
          />
        </label>
        <label className={styles.field}>
          To
          <input
            type="date"
            className={styles.input}
            value={params.get("to") ?? ""}
            onChange={(event) => setFilter("to", event.target.value)}
          />
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFilter("search", search.trim());
          }}
        >
          <label className={styles.field}>
            Search a lead or person
            <input
              type="search"
              className={styles.input}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onBlur={() => setFilter("search", search.trim())}
            />
          </label>
        </form>
      </div>
      {error ? <ErrorMessage error={error} /> : null}
      <div role="table" aria-label="Audit trail" className={styles.table}>
        <div role="row" className={`${styles.row} ${styles.headRow}`}>
          <span role="columnheader">When</span>
          <span role="columnheader">Who</span>
          <span role="columnheader">What happened</span>
          <span role="columnheader">Record</span>
        </div>
        {events?.length === 0 ? (
          <div className={styles.empty}>Nothing matches these filters.</div>
        ) : null}
        {events?.map((event) => (
          <div role="row" key={event.id} className={styles.row}>
            <span role="cell" className={styles.when}>
              {formatInstant(parseInstant(event.occurredAt), "dateTime")}
            </span>
            <span role="cell" className={styles.who}>
              <span className={styles.initials} aria-hidden="true">
                {event.actor ? initials(event.actor.name) : "—"}
              </span>
              {event.actor
                ? `${event.actor.name}${event.actor.status === "ACTIVE" ? "" : " (deactivated)"}`
                : "System"}
            </span>
            <span role="cell">{event.summary}</span>
            <span role="cell" className={styles.record}>
              {event.entityType === "lead" ? (
                <Link href={`/leads/${event.entityId}`}>Open lead</Link>
              ) : event.entityType === "contact" && can("privacy:manage") ? (
                <Link href={`/privacy?contact=${event.entityId}`}>Open customer</Link>
              ) : (
                event.entityType.replaceAll("_", " ")
              )}
            </span>
          </div>
        ))}
      </div>
      {nextAfter ? (
        <div>
          <button type="button" className={styles.button} onClick={loadMore}>
            Show more
          </button>
        </div>
      ) : null}
    </main>
  );
}
