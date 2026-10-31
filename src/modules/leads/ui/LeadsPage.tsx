"use client";

// The lead list. Filters, sort and page live in the URL, so Back returns to the same view. The server
// filters and sorts, so every column stays correct across pages and only leads in scope are counted.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { useShortcuts } from "@/shared/ui/useShortcuts";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { LEAD_SOURCES, SOURCE_LABELS, type LeadSource } from "../leads.types";
import { NewLeadDialog } from "./NewLeadDialog";
import {
  OwnerLabel,
  StageChip,
  budgetLabel,
  dateLabel,
  dueClass,
  instantLabel,
  phoneLabel,
  tripDates,
  type LeadRow,
  type StageOption,
} from "./shared";
import styles from "./leads.module.css";

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;
const VIEW_LEADS = ["leads:view-own", "leads:view-team", "leads:view-all"] as const;

const COLUMNS = [
  { sort: "customer", label: "Customer" },
  { sort: "phone", label: "Phone" },
  { sort: "destination", label: "Destination" },
  { sort: "travelStartDate", label: "Travel dates" },
  { sort: "travellerCount", label: "People" },
  { sort: "budgetAmount", label: "Budget" },
  { sort: "stage", label: "Stage" },
  { sort: "owner", label: "Owner" },
  { sort: "lastActivityAt", label: "Last activity" },
  { sort: "nextFollowUpDate", label: "Next follow-up" },
  { sort: "source", label: "Source" },
] as const;

type QuickKey = "open" | "overdue" | "today" | "noFollowUp";

interface ListResult {
  items: LeadRow[];
  total: number;
  openCount: number;
  quickCounts: Record<QuickKey, number>;
}

const QUICK: ReadonlyArray<{ key: QuickKey; label: string }> = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "noFollowUp", label: "No follow-up" },
];
const LIST_NOTICES = [
  "leads.leadChanged",
  "assignment.leadOwnerChanged",
  "messaging.conversationChanged",
];

export function LeadsPage() {
  const access = usePageAccess(VIEW_LEADS);
  const { can } = usePrincipal();
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const search = params.get("search") ?? "";
  const stage = params.get("stage") ?? "";
  const owner = params.get("owner") ?? "";
  const source = params.get("source") ?? "";
  const destination = params.get("destination") ?? "";
  const travelFrom = params.get("travelFrom") ?? "";
  const travelTo = params.get("travelTo") ?? "";
  const sort = params.get("sort") ?? "lastActivityAt";
  const direction = params.get("direction") === "asc" ? "asc" : "desc";
  const quick = params.get("quick") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [cursor, setCursor] = useState(-1);
  const [live, setLive] = useState(0);
  const refreshLive = useCallback(() => setLive((n) => n + 1), []);
  useLiveEvents({ types: LIST_NOTICES, onEvent: refreshLive, onResync: refreshLive });

  const [searchText, setSearchText] = useState(search);
  const [destinationText, setDestinationText] = useState(destination);
  const [result, setResult] = useState<ListResult | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const heading = can("leads:view-all")
    ? "Leads"
    : can("leads:view-team")
      ? "Team leads"
      : "My leads";
  useShortcuts({
    j: () => setCursor((now) => Math.min(now + 1, (result?.items.length ?? 0) - 1)),
    k: () => setCursor((now) => Math.max(now - 1, 0)),
    Enter: () => {
      const lead = result?.items[cursor];
      if (lead) router.push(`/leads/${lead.id}`);
    },
    "/": () => document.getElementById("leads-search")?.focus(),
  });

  const filtered = Boolean(
    search || stage || owner || source || destination || travelFrom || travelTo || quick,
  );

  const update = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(query);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const text = next.toString();
      router.replace(text ? `/leads?${text}` : "/leads", { scroll: false });
    },
    [query, router],
  );

  useEffect(() => {
    if (searchText === search && destinationText === destination) return;
    const timer = setTimeout(
      () => update({ search: searchText, destination: destinationText, page: "" }),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [searchText, destinationText, search, destination, update]);

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    const request = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
      direction,
    });
    for (const [key, value] of Object.entries({
      search,
      stage,
      owner,
      source,
      destination,
      travelFrom,
      travelTo,
      quick,
    })) {
      if (value) request.set(key, value);
    }
    apiRequest<ListResult>(`/api/leads?${request}`, { signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      if (next.ok) {
        setResult(next.data);
        setError(null);
      } else setError(next.error);
    });
    return () => controller.abort();
  }, [
    access,
    attempt,
    page,
    sort,
    direction,
    search,
    stage,
    owner,
    source,
    destination,
    travelFrom,
    travelTo,
    quick,
    live,
  ]);

  useEffect(() => {
    if (access !== "allowed") return;
    apiRequest<StageOption[]>("/api/leads/stages").then((next) => {
      if (next.ok) setStages(next.data);
    });
  }, [access]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main>
        <h1 className={styles.title}>Leads</h1>
        <ErrorMessage error={access} />
      </main>
    );
  }

  const lastPage = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>
          {heading}{" "}
          {result ? <span className={styles.titleNote}>· {result.openCount} open</span> : null}
        </h1>
        <input
          id="leads-search"
          aria-label="Search name or phone"
          placeholder="Search name or phone"
          className={`${styles.control} ${styles.search}`}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        {can("leads:create") ? (
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => setAdding(true)}
          >
            + New lead
          </button>
        ) : null}
      </div>

      <div role="group" aria-label="Quick filters" className={styles.pills}>
        {QUICK.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={styles.pill}
            aria-pressed={quick === key}
            onClick={() => update({ quick: quick === key ? "" : key, page: "" })}
          >
            {label}
            {result ? ` · ${result.quickCounts[key]}` : ""}
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        <label className={styles.filterField}>
          Stage
          <select
            className={styles.control}
            value={stage}
            onChange={(e) => update({ stage: e.target.value, page: "" })}
          >
            <option value="">All</option>
            {stages.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {can("leads:view-team") || can("leads:view-all") ? (
          <label className={styles.filterField}>
            Owner
            <select
              className={styles.control}
              value={owner === "unassigned" ? owner : ""}
              onChange={(e) => update({ owner: e.target.value, page: "" })}
            >
              <option value="">Any</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
        ) : null}
        <label className={styles.filterField}>
          Source
          <select
            className={styles.control}
            value={source}
            onChange={(e) => update({ source: e.target.value, page: "" })}
          >
            <option value="">Any</option>
            {LEAD_SOURCES.map((item) => (
              <option key={item} value={item}>
                {SOURCE_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          Destination
          <input
            className={styles.control}
            value={destinationText}
            onChange={(e) => setDestinationText(e.target.value)}
          />
        </label>
        <label className={styles.filterField}>
          Travel from
          <input
            type="date"
            className={styles.control}
            value={travelFrom}
            onChange={(e) => update({ travelFrom: e.target.value, page: "" })}
          />
        </label>
        <label className={styles.filterField}>
          Travel to
          <input
            type="date"
            className={styles.control}
            value={travelTo}
            onChange={(e) => update({ travelTo: e.target.value, page: "" })}
          />
        </label>
      </div>

      {error ? (
        <div className={styles.empty}>
          <ErrorMessage error={error} />
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      ) : null}
      {!result && !error ? <p aria-busy="true">Loading leads…</p> : null}
      {result?.items.length === 0 && !error ? (
        filtered ? (
          <div className={styles.empty}>
            <strong>No leads match these filters</strong>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setSearchText("");
                setDestinationText("");
                router.replace("/leads", { scroll: false });
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>No leads yet</span>
            <span className={styles.muted}>
              New enquiries appear here as soon as they reach you.
            </span>
          </div>
        )
      ) : null}

      {result && result.items.length > 0 && !error ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const current = sort === column.sort;
                  return (
                    <th
                      key={column.sort}
                      aria-sort={
                        current ? (direction === "asc" ? "ascending" : "descending") : "none"
                      }
                    >
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() =>
                          update({
                            sort: column.sort,
                            direction: current && direction === "asc" ? "desc" : "asc",
                            page: "",
                          })
                        }
                      >
                        {column.label} {current ? (direction === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {result.items.map((lead, index) => (
                <tr
                  key={lead.id}
                  aria-selected={index === cursor ? true : undefined}
                  className={index === cursor ? styles.rowCursor : undefined}
                >
                  <td>
                    <Link className={styles.rowLink} href={`/leads/${lead.id}`}>
                      {lead.contact.name ?? "Unnamed customer"}
                    </Link>
                  </td>
                  <td className={styles.nums}>{phoneLabel(lead.contact.phoneE164)}</td>
                  <td>{lead.destination ?? "—"}</td>
                  <td>{tripDates(lead)}</td>
                  <td className={styles.nums}>{lead.travellerCount ?? "—"}</td>
                  <td className={styles.nums}>{budgetLabel(lead.budgetAmount)}</td>
                  <td>
                    <StageChip code={lead.stage.code} name={lead.stage.name} />
                  </td>
                  <td>
                    <OwnerLabel owner={lead.owner} />
                  </td>
                  <td>{instantLabel(lead.lastActivityAt)}</td>
                  <td className={dueClass(lead.nextFollowUpDate)}>
                    {dateLabel(lead.nextFollowUpDate)}
                  </td>
                  <td>{SOURCE_LABELS[lead.source as LeadSource] ?? lead.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {lastPage > 1 ? (
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.button}
            disabled={page <= 1}
            onClick={() => update({ page: page > 2 ? String(page - 1) : "" })}
          >
            Previous
          </button>
          <span>
            Page {page} of {lastPage}
          </span>
          <button
            type="button"
            className={styles.button}
            disabled={page >= lastPage}
            onClick={() => update({ page: String(page + 1) })}
          >
            Next
          </button>
        </div>
      ) : null}

      {adding ? (
        <NewLeadDialog
          onClose={() => setAdding(false)}
          onCreated={(id) => router.push(`/leads/${id}`)}
        />
      ) : null}
    </main>
  );
}
