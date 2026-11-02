"use client";

// The lead list. Filters, sort and page live in the URL, so Back returns to the same view. The server
// filters and sorts, so every column stays correct across pages and only leads in scope are counted.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { useShortcuts } from "@/shared/ui/useShortcuts";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { Icon } from "@/shared/ui/Icon";
import { toastSuccess } from "@/shared/ui/toast";
import { addBusinessDays, todayBusinessDate, systemClock } from "@/shared/time";
import { LEAD_SOURCES, SOURCE_LABELS, type LeadSource } from "../leads.types";
import { BulkDialog, type BulkAction } from "./LeadsBulk";
import { NewLeadDialog } from "./NewLeadDialog";
import {
  OwnerLabel,
  StageChip,
  budgetLabel,
  dateLabel,
  dueClass,
  instantLabel,
  phoneLabel,
  recentLabel,
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

const SORT_LABELS: Record<string, string> = Object.fromEntries(
  COLUMNS.map((column) => [column.sort, column.label.toLowerCase()]),
);
const FILTER_KEYS = [
  "search",
  "stage",
  "owner",
  "source",
  "destination",
  "travelFrom",
  "travelTo",
  "quick",
  "sort",
  "direction",
] as const;
const EXPORT_DAYS = 90;

interface SavedView {
  name: string;
  query: string;
}
const SAVED_KEY = "eh.savedLeadViews";

function readSaved(userId: string | undefined): SavedView[] {
  if (!userId) return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(`${SAVED_KEY}.${userId}`) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is SavedView =>
            typeof item?.name === "string" && typeof item?.query === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeSaved(userId: string, views: SavedView[]) {
  try {
    window.localStorage.setItem(`${SAVED_KEY}.${userId}`, JSON.stringify(views));
  } catch {
    // saved views are a convenience in this browser only
  }
}

/** A filter as a pill that opens its choices (Leads-Desktop design). */
function FilterPill({
  label,
  value,
  active,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  children: (close: () => void) => ReactNode;
}) {
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
  return (
    <div className={styles.filterPillWrap} ref={wrap}>
      <button
        type="button"
        className={active ? `${styles.filterPill} ${styles.filterPillOn}` : styles.filterPill}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {label}: {value}
        <Icon name="chevronDown" size={14} strokeWidth={2} />
      </button>
      {open ? (
        <div className={styles.popover} role="group" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function Choices({
  options,
  value,
  onPick,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <>
      {options.map((option) => (
        <button
          key={option.value || "any"}
          type="button"
          className={styles.popoverItem}
          aria-pressed={value === option.value}
          onClick={() => onPick(option.value)}
        >
          {option.label}
          {value === option.value ? <Icon name="check" size={16} strokeWidth={2} /> : null}
        </button>
      ))}
    </>
  );
}

export function LeadsPage() {
  const access = usePageAccess(VIEW_LEADS);
  const { can, person } = usePrincipal();
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const canBulk = can("leads:reassign") || can("leads:edit");
  const personId = person?.id;
  useEffect(() => {
    const timer = setTimeout(() => setSaved(readSaved(personId)), 0);
    return () => clearTimeout(timer);
  }, [personId]);

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
  const items = result?.items ?? [];
  const pageIds = items.map((lead) => lead.id);
  const allPicked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const togglePick = (id: string) =>
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stageName = stages.find((item) => item.code === stage)?.name ?? "All";
  const sourceName = source ? (SOURCE_LABELS[source as LeadSource] ?? source) : "Any";
  const travelValue =
    travelFrom || travelTo
      ? [travelFrom ? dateLabel(travelFrom) : "…", travelTo ? dateLabel(travelTo) : "…"].join(" – ")
      : "Any";
  const currentView = new URLSearchParams(
    FILTER_KEYS.flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value] as [string, string]] : [];
    }),
  ).toString();
  const today = todayBusinessDate(systemClock);
  const exportHref = `/api/reports/export?${new URLSearchParams({
    kind: "leads",
    from: addBusinessDays(today, -EXPORT_DAYS),
    to: today,
    ...(source ? { source } : {}),
  })}`;
  const first = (page - 1) * PAGE_SIZE + 1;

  function saveView() {
    const name = viewName.trim();
    if (!personId || !name || !currentView) return;
    const next = [...saved.filter((view) => view.name !== name), { name, query: currentView }];
    setSaved(next);
    writeSaved(personId, next);
    setNaming(false);
    setViewName("");
  }

  function removeView(name: string) {
    if (!personId) return;
    const next = saved.filter((view) => view.name !== name);
    setSaved(next);
    writeSaved(personId, next);
  }

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>
          {heading}{" "}
          {result ? <span className={styles.titleNote}>· {result.openCount} open</span> : null}
        </h1>
        <div className={styles.searchBox}>
          <Icon name="search" size={18} />
          <input
            id="leads-search"
            aria-label="Search name or phone"
            placeholder="Search name or phone"
            className={styles.searchInput}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={`${styles.button} ${styles.filterToggle}`}
          aria-expanded={showFilters}
          aria-label="Filters"
          onClick={() => setShowFilters((was) => !was)}
        >
          <Icon name="filter" size={18} />
        </button>
        {can("reports:export") ? (
          <a
            className={`${styles.button} ${styles.desktopOnly}`}
            href={exportHref}
            download
            title={`Download leads created in the last ${EXPORT_DAYS} days as a spreadsheet (CSV)`}
          >
            Export
          </a>
        ) : null}
        {can("leads:create") ? (
          <button
            type="button"
            className={`${styles.button} ${styles.primary} ${styles.desktopOnly}`}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={18} strokeWidth={2} />
            New lead
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

      <div
        className={showFilters ? `${styles.filterRow} ${styles.filterRowOpen}` : styles.filterRow}
      >
        <FilterPill label="Stage" value={stageName} active={Boolean(stage)}>
          {(close) => (
            <Choices
              options={[
                { value: "", label: "All" },
                ...stages.map((item) => ({ value: item.code, label: item.name })),
              ]}
              value={stage}
              onPick={(value) => {
                update({ stage: value, page: "" });
                close();
              }}
            />
          )}
        </FilterPill>
        {can("leads:view-team") || can("leads:view-all") ? (
          <FilterPill
            label="Owner"
            value={owner === "unassigned" ? "Unassigned" : "Any"}
            active={owner === "unassigned"}
          >
            {(close) => (
              <Choices
                options={[
                  { value: "", label: "Any" },
                  { value: "unassigned", label: "Unassigned" },
                ]}
                value={owner === "unassigned" ? owner : ""}
                onPick={(value) => {
                  update({ owner: value, page: "" });
                  close();
                }}
              />
            )}
          </FilterPill>
        ) : null}
        <FilterPill label="Source" value={sourceName} active={Boolean(source)}>
          {(close) => (
            <Choices
              options={[
                { value: "", label: "Any" },
                ...LEAD_SOURCES.map((item) => ({ value: item, label: SOURCE_LABELS[item] })),
              ]}
              value={source}
              onPick={(value) => {
                update({ source: value, page: "" });
                close();
              }}
            />
          )}
        </FilterPill>
        <FilterPill label="Destination" value={destination || "Any"} active={Boolean(destination)}>
          {() => (
            <label className={styles.popoverField}>
              Destination
              <input
                className={styles.control}
                value={destinationText}
                placeholder="e.g. Kashmir"
                onChange={(e) => setDestinationText(e.target.value)}
              />
            </label>
          )}
        </FilterPill>
        <FilterPill
          label="Travel dates"
          value={travelValue}
          active={Boolean(travelFrom || travelTo)}
        >
          {() => (
            <>
              <label className={styles.popoverField}>
                Travel from
                <input
                  type="date"
                  className={styles.control}
                  value={travelFrom}
                  onChange={(e) => update({ travelFrom: e.target.value, page: "" })}
                />
              </label>
              <label className={styles.popoverField}>
                Travel to
                <input
                  type="date"
                  className={styles.control}
                  value={travelTo}
                  onChange={(e) => update({ travelTo: e.target.value, page: "" })}
                />
              </label>
            </>
          )}
        </FilterPill>
        {personId ? (
          <div className={styles.saved}>
            {saved.length > 0 ? <span className={styles.savedLabel}>Saved:</span> : null}
            {saved.map((view) => (
              <span key={view.name} className={styles.savedChip}>
                <button
                  type="button"
                  className={styles.savedOpen}
                  aria-pressed={view.query === currentView}
                  onClick={() => router.replace(`/leads?${view.query}`, { scroll: false })}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className={styles.savedRemove}
                  aria-label={`Remove saved view ${view.name}`}
                  onClick={() => removeView(view.name)}
                >
                  <Icon name="close" size={12} strokeWidth={2} />
                </button>
              </span>
            ))}
            {naming ? (
              <form
                className={styles.saveForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  saveView();
                }}
              >
                <input
                  aria-label="Name this view"
                  className={styles.control}
                  placeholder="Name this view"
                  maxLength={40}
                  value={viewName}
                  autoFocus
                  onChange={(event) => setViewName(event.target.value)}
                />
                <button type="submit" className={styles.button} disabled={!viewName.trim()}>
                  Save
                </button>
                <button type="button" className={styles.button} onClick={() => setNaming(false)}>
                  Cancel
                </button>
              </form>
            ) : currentView ? (
              <button type="button" className={styles.saveCurrent} onClick={() => setNaming(true)}>
                + Save current
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <label className={styles.sortLine}>
        Sorted by
        <select
          className={styles.sortSelect}
          value={sort}
          onChange={(event) =>
            update({
              sort: event.target.value,
              direction: event.target.value === "lastActivityAt" ? "" : "asc",
              page: "",
            })
          }
        >
          {COLUMNS.map((column) => (
            <option key={column.sort} value={column.sort}>
              {SORT_LABELS[column.sort]}
            </option>
          ))}
        </select>
      </label>

      {canBulk && selected.size > 0 ? (
        <div className={styles.bulkBar} role="region" aria-label="Selected leads">
          <strong>{selected.size} selected</strong>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
          <span className={styles.bulkActions}>
            {can("leads:reassign") ? (
              <button type="button" className={styles.button} onClick={() => setBulk("reassign")}>
                Reassign
              </button>
            ) : null}
            {can("leads:edit") ? (
              <>
                <button type="button" className={styles.button} onClick={() => setBulk("stage")}>
                  Change stage
                </button>
                <button type="button" className={styles.button} onClick={() => setBulk("followUp")}>
                  Set follow-up
                </button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>We couldn’t load your leads</span>
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
      {!result && !error ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading leads">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={styles.skeletonRow} />
          ))}
        </div>
      ) : null}
      {result?.items.length === 0 && !error ? (
        filtered ? (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>
              {search ? `No leads match “${search}”` : "No leads match these filters"}
            </span>
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
            {can("leads:claim") ? (
              <Link className={styles.button} href="/blast">
                Check the Blast pool
              </Link>
            ) : null}
          </div>
        )
      ) : null}

      {result && result.items.length > 0 && !error ? (
        <>
          <div className={`${styles.tableWrap} ${styles.desktopTable}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {canBulk ? (
                    <th className={styles.pickCell}>
                      <input
                        type="checkbox"
                        aria-label="Select all leads on this page"
                        checked={allPicked}
                        onChange={() =>
                          setSelected(allPicked ? new Set() : new Set([...selected, ...pageIds]))
                        }
                      />
                    </th>
                  ) : null}
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
                          {column.label} {current ? (direction === "asc" ? "↑" : "↓") : "↕"}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map((lead, index) => (
                  <tr
                    key={lead.id}
                    aria-selected={index === cursor || selected.has(lead.id) ? true : undefined}
                    className={
                      index === cursor
                        ? styles.rowCursor
                        : selected.has(lead.id)
                          ? styles.rowPicked
                          : undefined
                    }
                  >
                    {canBulk ? (
                      <td className={styles.pickCell}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${lead.contact.name ?? "this lead"}`}
                          checked={selected.has(lead.id)}
                          onChange={() => togglePick(lead.id)}
                        />
                      </td>
                    ) : null}
                    <td className={styles.nameCell}>
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
                    <td title={instantLabel(lead.lastActivityAt)}>
                      {recentLabel(lead.lastActivityAt)}
                    </td>
                    <td className={dueClass(lead.nextFollowUpDate)}>
                      {dateLabel(lead.nextFollowUpDate)}
                    </td>
                    <td>{SOURCE_LABELS[lead.source as LeadSource] ?? lead.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={styles.cards} aria-label={heading}>
            {items.map((lead) => (
              <li key={lead.id}>
                <Link className={styles.leadCard} href={`/leads/${lead.id}`}>
                  <span className={styles.cardTop}>
                    <span className={styles.cardName}>
                      {lead.contact.name ?? "Unnamed customer"}
                    </span>
                    <StageChip code={lead.stage.code} name={lead.stage.name} />
                  </span>
                  <span className={styles.cardMeta}>
                    {[
                      lead.destination,
                      tripDates(lead) === "—" ? null : tripDates(lead),
                      lead.travellerCount ? `${lead.travellerCount} people` : null,
                      lead.budgetAmount ? budgetLabel(lead.budgetAmount) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className={styles.cardFoot}>
                    <span className={`${styles.cardDue} ${dueClass(lead.nextFollowUpDate)}`}>
                      {lead.nextFollowUpDate
                        ? `${lead.nextFollowUpDate < today ? "Overdue" : lead.nextFollowUpDate === today ? "Due today" : "Follow-up"} · ${dateLabel(lead.nextFollowUpDate)}`
                        : "No follow-up set"}
                    </span>
                    <span className={styles.muted}>{recentLabel(lead.lastActivityAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className={styles.showing}>
            Showing {first}–{first + items.length - 1} of {result.total}
            <span className={styles.desktopOnly}> · press J / K to move, Enter to open</span>
          </p>
        </>
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

      {can("leads:create") ? (
        <button
          type="button"
          className={styles.fab}
          aria-label="New lead"
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={26} strokeWidth={2} />
        </button>
      ) : null}

      {adding ? (
        <NewLeadDialog
          onClose={() => setAdding(false)}
          onCreated={(id) => router.push(`/leads/${id}`)}
        />
      ) : null}
      {bulk ? (
        <BulkDialog
          action={bulk}
          leadIds={[...selected]}
          stages={stages}
          onClose={() => setBulk(null)}
          onDone={(message) => {
            setBulk(null);
            setSelected(new Set());
            setAttempt((n) => n + 1);
            toastSuccess(message);
          }}
        />
      ) : null}
    </main>
  );
}
