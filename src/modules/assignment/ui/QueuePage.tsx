"use client";

// The manager's queue: unassigned enquiries, and the panel that shares them out. A preview changes
// nothing; confirming sends that exact plan, and the result says what could not be done (Decision 59).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { parseInstant, systemClock } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { UNDO_SECONDS } from "../assignment.types";
import styles from "./assignment.module.css";

const NOTICES = [
  "assignment.queueChanged",
  "assignment.poolChanged",
  "messaging.conversationChanged",
];
const FILTERS = ["all", "waiting", "whatsapp"] as const;
type Filter = (typeof FILTERS)[number];
const REFRESH_MS = 15_000;

type Mode =
  | "ROUND_ROBIN"
  | "LEAST_LOADED"
  | "PRIORITY_TIER"
  | "PRIORITY_VALUE"
  | "RANDOM"
  | "MANUAL"
  | "BLAST";
const MODES: ReadonlyArray<{ key: Mode; title: string; detail: string }> = [
  { key: "ROUND_ROBIN", title: "Round-robin", detail: "Deal them out evenly, in turn." },
  {
    key: "LEAST_LOADED",
    title: "Least busy",
    detail: "Each goes to whoever has the fewest open leads.",
  },
  {
    key: "PRIORITY_TIER",
    title: "By tier",
    detail: "Senior agents fill up first, then the next tier.",
  },
  { key: "PRIORITY_VALUE", title: "By value", detail: "The highest budgets go to the top agents." },
  { key: "RANDOM", title: "Random", detail: "Shuffle them among the agents you pick." },
  { key: "MANUAL", title: "One agent", detail: "Give them all to the agent you pick." },
  {
    key: "BLAST",
    title: "Blast",
    detail: "Offer them to several agents. First to accept gets the lead.",
  },
];
const BLOCKS: Record<string, string> = {
  unavailable: "Unavailable",
  on_leave: "On leave",
  off_shift: "Off shift",
  at_cap: "At cap",
};

interface QueueLead {
  id: string;
  source: string;
  destination: string | null;
  budgetAmount: string | null;
  createdAt: string;
  enquiry: string | null;
  poolEntryId: string | null;
  escalated: boolean;
  contact: { name: string | null; phoneE164: string };
}
interface Queue {
  items: QueueLead[];
  total: number;
  waitingLong: number;
  firstResponseMinutes: number;
}
interface Agent {
  id: string;
  name: string;
  openLeads: number;
  cap: number;
  room: number;
  block: string | null;
}
interface Preview {
  leadCount: number;
  leadIds: string[];
  rows: Array<{
    leadId: string;
    userId: string;
    customer: string | null;
    destination: string | null;
  }>;
  unplaced: string[];
  agents: Array<Agent & { adding: number }>;
}
interface Result {
  batchId: string;
  assignedCount: number;
  pooledCount: number;
  skippedTaken: number;
  leftInQueue: number;
  perAgent: Array<{ userId: string; name: string; count: number }>;
}

const SOURCES: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
  MANUAL: "Manual",
  WEBSITE: "Website",
  AD: "Ad",
  IMPORT: "Import",
};
const rupees = (amount: string) => `₹${new Intl.NumberFormat("en-IN").format(Number(amount))}`;
const newKey = () => crypto.randomUUID();
const minutesWaiting = (createdAt: string) =>
  Math.max(
    0,
    Math.floor((systemClock.now().getTime() - parseInstant(createdAt).getTime()) / 60_000),
  );

function waitLabel(minutes: number) {
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
}

function AssignPanel({
  selected,
  all,
  count,
  onClose,
  onChanged,
}: {
  selected: string[];
  all: boolean;
  count: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<Mode>("ROUND_ROBIN");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoLeft, setUndoLeft] = useState(0);
  const key = useRef(newKey());

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: Agent[] }>("/api/assignment/agents", { signal: controller.signal }).then(
      (next) => {
        if (next.ok) {
          setAgents(next.data.items);
          setChosen(next.data.items.filter((agent) => !agent.block).map((agent) => agent.id));
        } else if (!controller.signal.aborted) setError(next.error);
      },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (undoLeft <= 0) return;
    const timer = setTimeout(() => setUndoLeft((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [undoLeft]);

  const single = mode === "MANUAL";
  const apiMode = mode.startsWith("PRIORITY") ? "PRIORITY" : mode;
  const room = agents
    .filter((agent) => chosen.includes(agent.id))
    .reduce((sum, agent) => sum + agent.room, 0);

  function pick(id: string) {
    setChosen((now) =>
      single ? [id] : now.includes(id) ? now.filter((other) => other !== id) : [...now, id],
    );
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    const next = await apiRequest<Preview>("/api/assignment/preview", {
      method: "POST",
      body: {
        ...(all ? { all: true } : { leadIds: selected }),
        userIds: chosen,
        mode: apiMode,
        ...(apiMode === "PRIORITY"
          ? { priorityBy: mode === "PRIORITY_VALUE" ? "value" : "tier" }
          : {}),
      },
    });
    setBusy(false);
    if (!next.ok) {
      setError(next.error);
      return;
    }
    key.current = newKey();
    setPreview(next.data);
    setStep(3);
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const next = await apiRequest<Result>("/api/assignment/batches", {
      method: "POST",
      body: {
        idempotencyKey: key.current,
        mode: apiMode,
        ...(apiMode === "BLAST"
          ? { offers: { leadIds: preview.leadIds, userIds: chosen } }
          : { rows: preview.rows.map(({ leadId, userId }) => ({ leadId, userId })) }),
      },
    });
    setBusy(false);
    if (!next.ok) {
      setError(next.error);
      return;
    }
    setResult(next.data);
    setStep(4);
    setUndoLeft(UNDO_SECONDS);
    onChanged();
  }

  async function undo() {
    if (!result) return;
    const next = await apiRequest(`/api/assignment/batches/${result.batchId}/undo`, {
      method: "POST",
    });
    if (next.ok) {
      onChanged();
      onClose();
    } else setError(next.error);
  }

  const assignable = preview?.rows.length ?? 0;
  const isBlast = apiMode === "BLAST";
  const noneEligible =
    !!preview && (isBlast ? preview.agents.every((agent) => agent.block) : assignable === 0);

  return (
    <aside aria-label="Assign leads" role="dialog" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>{step === 4 ? "Done" : `Assign ${count} ${count === 1 ? "lead" : "leads"}`}</h2>
        <button type="button" className={styles.linkButton} onClick={onClose}>
          Close
        </button>
      </div>
      <div className={styles.steps} aria-label={`Step ${step} of 4`}>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`${styles.step} ${n <= step ? styles.stepOn : ""}`} />
        ))}
      </div>
      {error ? <ErrorMessage error={error} /> : null}

      {step === 1 ? (
        <>
          <span className={styles.muted}>How should we share them out?</span>
          {MODES.map((option) => (
            <label key={option.key} className={styles.option}>
              <input
                type="radio"
                name="mode"
                checked={mode === option.key}
                onChange={() => {
                  setMode(option.key);
                  if (option.key === "MANUAL") setChosen((now) => now.slice(0, 1));
                }}
              />
              <span className={styles.optionText}>
                {option.title}
                <span className={styles.muted}>{option.detail}</span>
              </span>
            </label>
          ))}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => setStep(2)}
            >
              Next: choose agents
            </button>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <span className={styles.muted}>
            {MODES.find((option) => option.key === mode)?.title} · {chosen.length} selected · room
            for {room}
          </span>
          {agents.length === 0 ? (
            <p className={styles.muted}>No agents to choose from yet.</p>
          ) : null}
          {agents.map((agent) => (
            <label
              key={agent.id}
              className={`${styles.option} ${agent.block ? styles.optionBlocked : ""}`}
            >
              <input
                type={single ? "radio" : "checkbox"}
                name="agent"
                disabled={Boolean(agent.block)}
                checked={chosen.includes(agent.id)}
                onChange={() => pick(agent.id)}
              />
              <span className={styles.optionText}>
                {agent.name}
                <span className={styles.muted}>
                  {agent.openLeads} of {agent.cap} open
                </span>
              </span>
              <span className={styles.right}>
                {agent.block ? BLOCKS[agent.block] : `Room for ${agent.room}`}
              </span>
            </label>
          ))}
          <span className={styles.muted}>
            Greyed agents can&apos;t take leads right now. Caps and shifts are set in{" "}
            <Link href="/assignment-rules">Assignment rules</Link>.
          </span>
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={busy || chosen.length === 0}
              onClick={runPreview}
            >
              Preview
            </button>
          </div>
        </>
      ) : null}

      {step === 3 && preview ? (
        <>
          {preview.leadCount === 0 ? (
            <div role="alert" className={styles.warning}>
              <b>Nothing left to assign.</b> These leads have already been taken.
            </div>
          ) : noneEligible ? (
            <div role="alert" className={styles.warning}>
              <b>No eligible agents.</b> Nothing has changed, and the leads are still in the queue.
            </div>
          ) : preview.unplaced.length > 0 ? (
            <div role="alert" className={styles.warning}>
              <b>
                {preview.unplaced.length}{" "}
                {preview.unplaced.length === 1 ? "lead stays" : "leads stay"} unassigned.
              </b>{" "}
              The agents you chose have no room for them right now, or don&apos;t cover their
              language or destination.
            </div>
          ) : null}
          {isBlast ? (
            <p className={styles.muted}>
              {preview.leadCount} {preview.leadCount === 1 ? "lead" : "leads"} will be offered to{" "}
              {preview.agents
                .filter((agent) => !agent.block)
                .map((agent) => agent.name)
                .join(", ")}
              .
            </p>
          ) : (
            preview.agents
              .filter((agent) => agent.adding > 0)
              .map((agent) => (
                <div key={agent.id} className={styles.card}>
                  <div className={styles.cardRow}>
                    <span className={styles.optionText}>
                      {agent.name}
                      <span className={styles.muted}>
                        {agent.openLeads} open → {agent.openLeads + agent.adding} of {agent.cap} cap
                      </span>
                    </span>
                    <span className={styles.count}>+{agent.adding}</span>
                  </div>
                  <span className={styles.muted}>
                    {preview.rows
                      .filter((row) => row.userId === agent.id)
                      .slice(0, 5)
                      .map((row) => row.customer ?? "Unnamed customer")
                      .join(", ")}
                    {agent.adding > 5 ? ` +${agent.adding - 5}` : ""}
                  </span>
                </div>
              ))
          )}
          {preview.unplaced.length > 0 ? (
            <div className={`${styles.card} ${styles.dashed}`}>
              <div className={styles.cardRow}>
                <span>Stay in the queue</span>
                <span className={styles.count}>{preview.unplaced.length}</span>
              </div>
            </div>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setStep(2)}>
              Back
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={busy || noneEligible || preview.leadCount === 0}
              onClick={confirm}
            >
              {isBlast
                ? `Offer ${preview.leadCount} ${preview.leadCount === 1 ? "lead" : "leads"}`
                : `Assign ${assignable} ${assignable === 1 ? "lead" : "leads"}`}
            </button>
          </div>
        </>
      ) : null}

      {step === 4 && result ? (
        <>
          <p role="status" className={styles.headline}>
            {isBlast ? result.pooledCount : result.assignedCount}{" "}
            <span className={styles.accent}>{isBlast ? "offered" : "assigned"}</span>
          </p>
          {result.perAgent.map((row) => (
            <div key={row.userId} className={styles.cardRow}>
              {row.name}
              <span className={styles.count}>{row.count}</span>
            </div>
          ))}
          {result.skippedTaken > 0 ? (
            <div role="alert" className={styles.warning}>
              <b>Someone got there first.</b> {result.skippedTaken}{" "}
              {result.skippedTaken === 1 ? "lead was" : "leads were"} already taken, so we skipped{" "}
              {result.skippedTaken === 1 ? "it" : "them"}.
            </div>
          ) : null}
          {result.leftInQueue > 0 ? (
            <div role="alert" className={styles.warning}>
              {result.leftInQueue} {result.leftInQueue === 1 ? "lead stays" : "leads stay"} in the
              queue, because the agent can no longer take {result.leftInQueue === 1 ? "it" : "them"}
              .
            </div>
          ) : null}
          <div className={styles.actions}>
            {undoLeft > 0 ? (
              <button type="button" className={styles.button} onClick={undo}>
                Undo · {undoLeft} s
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={onClose}
            >
              Back to queue
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}

export function QueuePage() {
  const access = usePageAccess("leads:assign");
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("filter") as Filter | null;
  const filter: Filter = raw && FILTERS.includes(raw) ? raw : "all";
  const search = params.get("search") ?? "";
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [allSelected, setAllSelected] = useState(false);
  const [panel, setPanel] = useState(false);
  const [draft, setDraft] = useState(search);

  const refresh = useCallback(async () => {
    const query = new URLSearchParams({ filter, ...(search ? { search } : {}) });
    const next = await apiRequest<Queue>(`/api/assignment/queue?${query}`);
    if (next.ok) {
      setQueue(next.data);
      setError(null);
      // Anything assigned elsewhere drops out of the selection.
      const present = new Set(next.data.items.map((lead) => lead.id));
      setSelected((now) => now.filter((id) => present.has(id)));
    } else setError(next.error);
  }, [filter, search]);

  useLiveEvents({ types: NOTICES, onEvent: refresh, onResync: refresh });

  useEffect(() => {
    if (access !== "allowed") return;
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [access, refresh]);

  useEffect(() => {
    if (draft === search) return;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        ...(filter !== "all" ? { filter } : {}),
        ...(draft ? { search: draft } : {}),
      }).toString();
      router.replace(query ? `/queue?${query}` : "/queue", { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, search, filter, router]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main className={styles.page}>
        <h1 className={styles.headline}>Queue</h1>
        <ErrorMessage error={access} />
      </main>
    );
  }

  async function cancelOffer(entryId: string) {
    const done = await apiRequest(`/api/assignment/pool/${entryId}`, { method: "DELETE" });
    if (!done.ok) setError(done.error);
    refresh();
  }

  const selectable = queue?.items.filter((lead) => !lead.poolEntryId) ?? [];
  const count = allSelected ? (queue?.total ?? 0) : selected.length;
  const oldest = queue?.items[0] ? minutesWaiting(queue.items[0].createdAt) : 0;
  const sla = queue?.firstResponseMinutes ?? 15;
  const setFilter = (next: Filter) =>
    router.replace(next === "all" ? "/queue" : `/queue?filter=${next}`, { scroll: false });
  const toggle = (id: string) => {
    setAllSelected(false);
    setSelected((now) => (now.includes(id) ? now.filter((other) => other !== id) : [...now, id]));
  };

  return (
    <main className={styles.page}>
      <div>
        <h1 className={styles.headline}>
          {queue?.total ?? 0} new <span className={styles.accent}>enquiries</span>, unassigned
        </h1>
        {queue && queue.items.length > 0 ? (
          <span className={styles.muted}>
            Oldest has waited {waitLabel(oldest)} · first-response target is {sla} min
          </span>
        ) : null}
      </div>
      <div className={styles.bar}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={styles.pill}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {key === "all"
              ? "All"
              : key === "waiting"
                ? `Waiting > ${sla} min · ${queue?.waitingLong ?? 0}`
                : "WhatsApp"}
          </button>
        ))}
        <span className={styles.spacer} />
        <input
          className={styles.input}
          type="search"
          aria-label="Search name or phone"
          placeholder="Search name or phone"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      {error ? <ErrorMessage error={error} /> : null}

      <div className={styles.layout}>
        <div className={styles.main}>
          <div className={styles.selection}>
            <input
              type="checkbox"
              aria-label="Select every lead on this page"
              checked={selectable.length > 0 && selected.length === selectable.length}
              onChange={(event) => {
                setAllSelected(false);
                setSelected(event.target.checked ? selectable.map((lead) => lead.id) : []);
              }}
            />
            <b>{count} selected</b>
            {queue && queue.total > 0 && !allSelected ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setAllSelected(true)}
              >
                Select all {queue.total}
              </button>
            ) : null}
            {count > 0 ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setAllSelected(false);
                  setSelected([]);
                }}
              >
                Clear
              </button>
            ) : null}
            <span className={styles.spacer} />
            <button
              type="button"
              className={`${styles.button} ${styles.primary} ${styles.assignAction}`}
              disabled={count === 0}
              onClick={() => setPanel(true)}
            >
              Assign {count} {count === 1 ? "lead" : "leads"}
            </button>
          </div>
          <div role="table" aria-label="Unassigned enquiries" className={styles.table}>
            <div role="row" className={`${styles.row} ${styles.head}`}>
              <span />
              <span>Customer</span>
              <span>Enquiry</span>
              <span>Destination</span>
              <span>Budget</span>
              <span>Source</span>
              <span>Waiting</span>
            </div>
            {!queue ? (
              <p aria-busy="true" className={styles.muted}>
                Loading…
              </p>
            ) : null}
            {queue?.items.length === 0 ? (
              <p className={styles.muted} style={{ padding: 16 }}>
                The queue is clear. New enquiries appear here as they arrive.
              </p>
            ) : null}
            {queue?.items.map((lead) => {
              const minutes = minutesWaiting(lead.createdAt);
              const name = lead.contact.name ?? "Unnamed customer";
              return (
                <div role="row" key={lead.id} className={styles.row}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${name}`}
                    disabled={Boolean(lead.poolEntryId)}
                    checked={allSelected ? !lead.poolEntryId : selected.includes(lead.id)}
                    onChange={() => toggle(lead.id)}
                  />
                  <span className={styles.cell}>
                    <Link className={styles.name} href={`/leads/${lead.id}`}>
                      {name}
                    </Link>
                    <span className={styles.sub}>{lead.contact.phoneE164}</span>
                    {lead.escalated ? (
                      <span className={`${styles.chip} ${styles.chipWarn}`}>Needs a manager</span>
                    ) : null}
                    {lead.poolEntryId ? (
                      <>
                        <span className={`${styles.chip} ${styles.chipBlue}`}>In blast</span>{" "}
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={() => cancelOffer(lead.poolEntryId as string)}
                        >
                          Cancel offer
                        </button>
                      </>
                    ) : null}
                  </span>
                  <span className={`${styles.cell} ${styles.hideOnPhone}`}>
                    {lead.enquiry ?? "—"}
                  </span>
                  <span className={`${styles.cell} ${styles.hideOnPhone}`}>
                    {lead.destination ?? "—"}
                  </span>
                  <span className={`${styles.cell} ${styles.hideOnPhone}`}>
                    {lead.budgetAmount ? rupees(lead.budgetAmount) : "—"}
                  </span>
                  <span className={`${styles.cell} ${styles.hideOnPhone}`}>
                    <span className={styles.chip}>{SOURCES[lead.source] ?? lead.source}</span>
                  </span>
                  <span
                    className={
                      minutes >= sla ? styles.late : minutes >= sla / 2 ? styles.soon : styles.muted
                    }
                  >
                    {waitLabel(minutes)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {panel ? (
          <AssignPanel
            selected={selected}
            all={allSelected}
            count={count}
            onChanged={refresh}
            onClose={() => {
              setPanel(false);
              setSelected([]);
              setAllSelected(false);
              refresh();
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
