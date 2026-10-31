"use client";

// The home screen: your numbers, your team's or the company's, by permission.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { formatBusinessDate, parseInstant, systemClock } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { DayBars } from "./charts";
import { dayLabel, minutesLabel, rupees, talkLabel } from "./format";
import styles from "./reporting.module.css";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
] as const;
type Range = (typeof RANGES)[number]["key"];

interface Agent {
  userId: string;
  name: string;
  deactivated: boolean;
  open: number;
  leads: number;
  firstReplyMedian: number | null;
  calls: number;
  quoted: number;
  won: number;
}
interface Dashboard {
  scope: "own" | "team" | "all";
  today: string;
  leads: number;
  open: number;
  overdue: number;
  dueToday: number;
  quoted: number;
  won: number;
  value: string;
  conversionPercent: number;
  calls: number;
  talkSeconds: number;
  callsPerDay: Array<{ day: string; count: number }>;
  firstReplyMedian: number | null;
  targetMinutes: number;
  missedSla: number;
  queue: number | null;
  waiting: Array<{
    id: string;
    createdAt: string;
    destination: string | null;
    contact: { name: string | null };
  }>;
  agents: Agent[];
  upNext: Array<{
    id: string;
    title: string;
    dueDate: string;
    overdue: boolean;
    assignee: string;
    leadId: string;
    customer: string | null;
  }>;
}

const HEADINGS = {
  own: ["Your", "numbers"],
  team: ["Team", "pulse"],
  all: ["Company", "overview"],
};

export function DashboardPage() {
  const { state } = usePrincipal();
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);

  useEffect(() => {
    if (state !== "signed-in") return;
    const controller = new AbortController();
    apiRequest<Dashboard>(`/api/dashboard?range=${range}`, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setData(result.data);
          setError(null);
        } else setError(result.error);
      },
    );
    return () => controller.abort();
  }, [state, range]);

  const help = (
    <p className={styles.muted}>
      Need help? Email <a href={`mailto:${APP_CONFIG.support.email}`}>{APP_CONFIG.support.email}</a>{" "}
      or call <a href={APP_CONFIG.support.phoneTelHref}>{APP_CONFIG.support.phoneDisplay}</a>.
    </p>
  );

  // Someone with no dashboard permission, or not signed in, still gets a useful home page.
  if (state !== "signed-in" || error?.code === "FORBIDDEN") {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>{APP_CONFIG.product.name}</h1>
        {help}
      </main>
    );
  }
  if (error) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>{APP_CONFIG.product.name}</h1>
        <ErrorMessage error={error} />
      </main>
    );
  }
  if (!data)
    return (
      <main className={styles.page} aria-busy="true">
        Loading…
      </main>
    );

  const [first, second] = HEADINGS[data.scope];
  const own = data.scope === "own";
  const late = data.firstReplyMedian !== null && data.firstReplyMedian > data.targetMinutes;

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.muted}>{formatBusinessDate(data.today, "longDate")}</span>
          <h1 className={styles.title}>
            {first} <span className={styles.accent}>{second}</span>
          </h1>
        </div>
        <div className={styles.segments} role="group" aria-label="Period">
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              className={styles.segment}
              aria-pressed={range === option.key}
              onClick={() => setRange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tiles}>
        {data.queue !== null ? (
          <Link href="/queue" className={`${styles.tile} ${styles.tileDark}`}>
            <span className={styles.tileLabel}>Unassigned</span>
            <span className={styles.tileValue}>{data.queue}</span>
            <span className={styles.tileNote}>Open queue →</span>
          </Link>
        ) : null}
        <Link href="/leads?quick=open" className={styles.tile}>
          <span className={styles.tileLabel}>Open leads</span>
          <span className={styles.tileValue}>{data.open}</span>
          <span className={styles.tileNote}>{data.leads} new in this period</span>
        </Link>
        <Link
          href="/follow-ups?bucket=today"
          className={`${styles.tile} ${data.dueToday ? styles.tileDue : ""}`}
        >
          <span className={styles.tileLabel}>Follow-ups today</span>
          <span className={styles.tileValue}>{data.dueToday}</span>
        </Link>
        <Link
          href="/follow-ups?bucket=overdue"
          className={`${styles.tile} ${data.overdue ? styles.tileBad : ""}`}
        >
          <span className={styles.tileLabel}>Overdue</span>
          <span className={styles.tileValue}>{data.overdue}</span>
        </Link>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>First reply, median</span>
          <span className={styles.tileValue}>{minutesLabel(data.firstReplyMedian)}</span>
          <span className={styles.tileNote}>
            {late ? "Over" : "Target"} {data.targetMinutes} min
          </span>
        </div>
        <div className={`${styles.tile} ${data.missedSla ? styles.tileBad : ""}`}>
          <span className={styles.tileLabel}>Missed first-reply target</span>
          <span className={styles.tileValue}>{data.missedSla}</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>Calls</span>
          <span className={styles.tileValue}>{data.calls}</span>
          <span className={styles.tileNote}>{talkLabel(data.talkSeconds)} talk time</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>Booked</span>
          <span className={styles.tileValue}>{data.won}</span>
          <span className={styles.tileNote}>
            {rupees(data.value)} · {data.conversionPercent}% of {data.leads}
          </span>
        </div>
      </div>

      <div className={styles.columns}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Up next</h2>
            <Link href="/follow-ups" className={styles.muted}>
              All follow-ups
            </Link>
          </div>
          {data.upNext.length === 0 ? (
            <span className={styles.muted}>No follow-ups waiting.</span>
          ) : null}
          {data.upNext.map((task) => (
            <Link key={task.id} href={`/leads/${task.leadId}`} className={styles.item}>
              {task.customer ?? "Unnamed customer"}
              <span className={styles.muted}>
                {task.title} · {own ? "" : `${task.assignee} · `}
                {formatBusinessDate(task.dueDate, "date")}
              </span>
              {task.overdue ? <span className={styles.late}>Overdue</span> : null}
            </Link>
          ))}
        </section>
        {data.queue !== null ? (
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>Waiting longest</h2>
            </div>
            {data.waiting.length === 0 ? (
              <span className={styles.muted}>The queue is clear.</span>
            ) : null}
            {data.waiting.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`} className={styles.item}>
                {lead.contact.name ?? "Unnamed customer"}
                <span className={styles.muted}>
                  {lead.destination ?? "No destination"} · waiting{" "}
                  {Math.max(
                    0,
                    Math.floor(
                      (systemClock.now().getTime() - parseInstant(lead.createdAt).getTime()) /
                        60000,
                    ),
                  )}{" "}
                  min
                </span>
              </Link>
            ))}
          </section>
        ) : (
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>Calls this week</h2>
            </div>
            <DayBars label="Calls per day" rows={data.callsPerDay} dayLabel={dayLabel} />
          </section>
        )}
      </div>

      {!own ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Agents</h2>
            <Link href="/reports" className={styles.muted}>
              Full report
            </Link>
          </div>
          {data.agents.length === 0 ? (
            <span className={styles.muted}>No leads for anyone in this period.</span>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Open</th>
                    <th>New</th>
                    <th>First reply</th>
                    <th>Calls</th>
                    <th>At quote</th>
                    <th>Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => (
                    <tr key={agent.userId}>
                      <td>
                        {agent.name}
                        {agent.deactivated ? " (left)" : ""}
                      </td>
                      <td>{agent.open}</td>
                      <td>{agent.leads}</td>
                      <td>{minutesLabel(agent.firstReplyMedian)}</td>
                      <td>{agent.calls}</td>
                      <td>{agent.quoted}</td>
                      <td>{agent.won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
      {help}
    </main>
  );
}
