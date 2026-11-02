"use client";

// The home screen, shaped by who is looking (owner's designs Dash-Agent, Dash-Manager, Dash-Admin):
// an agent's own numbers, a manager's team pulse, or the company overview. Every figure comes from
// the dashboard and reports APIs, which apply the person's scope.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import {
  addBusinessDays,
  businessMoment,
  formatBusinessDate,
  parseInstant,
  systemClock,
  todayBusinessDate,
} from "@/shared/time";
import { Avatar } from "@/shared/ui/Avatar";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { toastError } from "@/shared/ui/toast";
import { DayColumns } from "./charts";
import { minutesLabel, rupees, talkLabel } from "./format";
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
interface UpNext {
  id: string;
  title: string;
  dueDate: string;
  overdue: boolean;
  assignee: string;
  leadId: string;
  customer: string | null;
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
  upNext: UpNext[];
}
interface Report {
  totals: { leads: number; won: number; lost: number; value: string; conversionPercent: number };
  stages: Array<{ code: string; name: string; kind: string; count: number }>;
  sources: Array<{ source: string; count: number }>;
  destinations: Array<{ destination: string; count: number }>;
  response: { median: number | null; missed: number; targetMinutes: number };
}
interface Roster {
  id: string;
  isAvailable: boolean;
  cap: number;
  openLeads: number;
  leaveFrom: string | null;
  leaveTo: string | null;
  block: string | null;
}
interface Team {
  id: string;
  name: string;
  manager: { name: string } | null;
}

const SOURCE_NAMES: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  AD: "Ad",
  WEBSITE: "Website",
  PHONE: "Phone",
  MANUAL: "Added by hand",
  IMPORT: "Imported",
};

const minutesSince = (iso: string) =>
  Math.max(0, Math.floor((systemClock.now().getTime() - parseInstant(iso).getTime()) / 60_000));

function waitedLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} days`;
}

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

function Tile({
  label,
  value,
  note,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  note?: string;
  href?: string;
  tone?: "dark" | "due" | "bad" | "good";
}) {
  const className = `${styles.tile} ${
    tone === "dark"
      ? styles.tileDark
      : tone === "due"
        ? styles.tileDue
        : tone === "bad"
          ? styles.tileBad
          : ""
  }`;
  const body = (
    <>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      {note ? (
        <span className={tone === "good" ? `${styles.tileNote} ${styles.good}` : styles.tileNote}>
          {note}
        </span>
      ) : null}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function RangePicker({ range, onChange }: { range: Range; onChange: (range: Range) => void }) {
  return (
    <div className={styles.segments} role="group" aria-label="Period">
      {RANGES.map((option) => (
        <button
          key={option.key}
          type="button"
          className={styles.segment}
          aria-pressed={range === option.key}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function UpNextList({
  tasks,
  showAssignee,
  canComplete,
  onDone,
}: {
  tasks: UpNext[];
  showAssignee: boolean;
  canComplete: boolean;
  onDone: () => void;
}) {
  const today = todayBusinessDate(systemClock);
  async function complete(task: UpNext) {
    const result = await apiRequest(`/api/leads/${task.leadId}/tasks/${task.id}`, {
      method: "PATCH",
      body: { completed: true },
    });
    if (result.ok) onDone();
    else toastError(result.error);
  }
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Up next</h2>
        <Link href="/follow-ups" className={styles.cardLink}>
          All follow-ups
        </Link>
      </div>
      {tasks.length === 0 ? <span className={styles.muted}>No follow-ups waiting.</span> : null}
      <ul className={styles.taskList}>
        {tasks.map((task) => (
          <li key={task.id} className={styles.taskRow}>
            <span
              className={
                task.overdue
                  ? `${styles.when} ${styles.whenLate}`
                  : task.dueDate === today
                    ? `${styles.when} ${styles.whenToday}`
                    : styles.when
              }
            >
              {task.overdue
                ? "Overdue"
                : task.dueDate === today
                  ? "Today"
                  : formatBusinessDate(task.dueDate, "date").replace(/ \d{4}$/, "")}
            </span>
            <Link href={`/leads/${task.leadId}`} className={styles.taskText}>
              <span className={styles.taskName}>{task.customer ?? "Unnamed customer"}</span>
              <span className={styles.muted}>
                {task.title}
                {showAssignee ? ` · ${task.assignee}` : ""} · due{" "}
                {formatBusinessDate(task.dueDate, "date")}
              </span>
            </Link>
            {canComplete ? (
              <button type="button" className={styles.doneButton} onClick={() => complete(task)}>
                Done
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function greeting(now: Date) {
  const hour = Math.floor(businessMoment(now).minute / 60);
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function AgentView({
  data,
  range,
  setRange,
  reload,
}: {
  data: Dashboard;
  range: Range;
  setRange: (range: Range) => void;
  reload: () => void;
}) {
  const { person, can } = usePrincipal();
  const firstName = person?.name.split(/\s+/)[0] ?? "";
  const period = range === "today" ? "today" : `in ${range} days`;
  const average =
    data.callsPerDay.length > 0
      ? Math.round(
          data.callsPerDay.reduce((sum, row) => sum + row.count, 0) / data.callsPerDay.length,
        )
      : 0;
  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.muted}>{formatBusinessDate(data.today, "longDate")}</span>
          <h1 className={styles.title}>
            {greeting(systemClock.now())}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <span className={styles.subtitle}>
            Your <span className={styles.accent}>numbers</span> {period}
          </span>
        </div>
        <RangePicker range={range} onChange={setRange} />
      </div>
      <div className={styles.tiles}>
        <Tile
          label="Open leads"
          value={data.open}
          note={`${data.leads} new ${period}`}
          href="/leads?quick=open"
        />
        <Tile
          label="Follow-ups today"
          value={data.dueToday}
          href="/follow-ups?bucket=today"
          tone={data.dueToday ? "due" : undefined}
        />
        <Tile
          label="Overdue"
          value={data.overdue}
          href="/follow-ups?bucket=overdue"
          tone={data.overdue ? "bad" : undefined}
        />
        <Tile label="Calls" value={data.calls} note={`${talkLabel(data.talkSeconds)} talk time`} />
        <Tile
          label="Quotes sent"
          value={data.quoted}
          note={period === "today" ? "Today" : `Last ${range} days`}
        />
        <Tile label="Bookings won" value={data.won} note={rupees(data.value)} />
      </div>
      <div className={styles.columnsWide}>
        <UpNextList
          tasks={data.upNext}
          showAssignee={false}
          canComplete={can("leads:edit")}
          onDone={reload}
        />
        <div className={styles.stack}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>Calls this week</h2>
              <span className={styles.muted}>Avg {average} a day</span>
            </div>
            <DayColumns label="Calls per day" rows={data.callsPerDay} />
          </section>
          <section className={styles.card}>
            <p className={styles.conversion}>
              Conversion {period}: <strong>{data.won} booked</strong> of {data.leads} new leads (
              {data.conversionPercent}%).
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function presenceOf(row: Roster | undefined, today: string) {
  if (!row) return { label: "—", tone: "" };
  if (row.leaveFrom && row.leaveTo && row.leaveFrom <= today && today <= row.leaveTo) {
    return {
      label: `On leave until ${formatBusinessDate(row.leaveTo, "date").replace(/ \d{4}$/, "")}`,
      tone: styles.presenceAway,
    };
  }
  if (!row.isAvailable) return { label: "Not taking leads", tone: styles.presenceAway };
  if (row.block === "at_cap") return { label: "At cap", tone: styles.presenceBusy };
  return { label: "Taking leads", tone: styles.presenceOn };
}

function ManagerView({
  data,
  range,
  setRange,
}: {
  data: Dashboard;
  range: Range;
  setRange: (range: Range) => void;
}) {
  const { can } = usePrincipal();
  const [roster, setRoster] = useState<Map<string, Roster>>(new Map());
  const seesRoster = can("leads:assign") || can("leads:reassign");
  useEffect(() => {
    if (!seesRoster) return;
    const controller = new AbortController();
    apiRequest<{ items: Roster[] }>("/api/assignment/agents", { signal: controller.signal }).then(
      (result) => {
        if (result.ok) setRoster(new Map(result.data.items.map((row) => [row.id, row])));
      },
    );
    return () => controller.abort();
  }, [seesRoster]);
  const today = data.today;
  const late = data.firstReplyMedian !== null && data.firstReplyMedian > data.targetMinutes;
  const activeAgents = data.agents.filter((agent) => !agent.deactivated).length;
  const attention = [
    ...data.waiting.map((lead) => ({
      key: `w-${lead.id}`,
      href: `/leads/${lead.id}`,
      tag: `Waiting ${waitedLabel(minutesSince(lead.createdAt))}`,
      tone: styles.tagWarning,
      name: lead.contact.name ?? "Unnamed customer",
      detail: `Unassigned${lead.destination ? ` · ${lead.destination}` : ""}`,
    })),
    ...data.upNext
      .filter((task) => task.overdue)
      .map((task) => ({
        key: `t-${task.id}`,
        href: `/leads/${task.leadId}`,
        tag: `Overdue since ${formatBusinessDate(task.dueDate, "date").replace(/ \d{4}$/, "")}`,
        tone: styles.tagDanger,
        name: task.customer ?? "Unnamed customer",
        detail: `${task.assignee} · ${task.title}`,
      })),
  ].slice(0, 6);

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.muted}>{formatBusinessDate(data.today, "longDate")}</span>
          <h1 className={styles.title}>
            Team <span className={styles.accent}>pulse</span>
          </h1>
        </div>
        <RangePicker range={range} onChange={setRange} />
      </div>
      <div className={styles.tiles}>
        {data.queue !== null ? (
          <Tile
            label="Unassigned"
            value={data.queue}
            note="Open queue →"
            href="/queue"
            tone="dark"
          />
        ) : null}
        <Tile
          label="Team’s open leads"
          value={data.open}
          note={`across ${activeAgents} ${activeAgents === 1 ? "agent" : "agents"}`}
          href="/leads?quick=open"
        />
        <Tile
          label="First reply, median"
          value={minutesLabel(data.firstReplyMedian)}
          note={`Target ${data.targetMinutes} min${data.firstReplyMedian === null ? "" : late ? " · over" : " · on track"}`}
          tone={late ? "bad" : undefined}
        />
        <Tile
          label="Missed first-reply target"
          value={data.missedSla}
          note={data.waiting.length ? `${data.waiting.length} still waiting` : undefined}
          tone={data.missedSla ? "bad" : undefined}
        />
        <Tile
          label="Follow-ups overdue"
          value={data.overdue}
          href="/follow-ups?bucket=overdue"
          tone={data.overdue ? "bad" : undefined}
        />
        <Tile
          label="Booked"
          value={data.won}
          note={`${rupees(data.value)} · ${data.conversionPercent}%`}
        />
      </div>
      <div className={styles.columnsWide}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Agents</h2>
            {can("reports:view") ? (
              <Link href="/reports" className={styles.cardLink}>
                Full report
              </Link>
            ) : null}
          </div>
          {data.agents.length === 0 ? (
            <span className={styles.muted}>No agents in this view yet.</span>
          ) : (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Agents">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Open / cap</th>
                    <th>New</th>
                    <th>First reply</th>
                    <th>Calls</th>
                    <th>Quotes</th>
                    <th>Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => {
                    const row = roster.get(agent.userId);
                    const presence = agent.deactivated
                      ? { label: "Left the company", tone: styles.presenceAway }
                      : presenceOf(row, today);
                    return (
                      <tr key={agent.userId}>
                        <td>
                          <span className={styles.agentCell}>
                            <Avatar name={agent.name} size={32} />
                            <span className={styles.agentText}>
                              <span className={styles.agentName}>{agent.name}</span>
                              {row || agent.deactivated ? (
                                <span className={`${styles.presence} ${presence.tone}`}>
                                  {presence.label}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </td>
                        <td className={row && row.openLeads >= row.cap ? styles.atCap : undefined}>
                          {agent.open}
                          {row ? ` / ${row.cap}` : ""}
                        </td>
                        <td>{agent.leads}</td>
                        <td>{minutesLabel(agent.firstReplyMedian)}</td>
                        <td>{agent.calls}</td>
                        <td>{agent.quoted}</td>
                        <td>{agent.won}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Needs attention</h2>
          </div>
          {attention.length === 0 ? (
            <span className={styles.muted}>Nothing is waiting on you. Nice.</span>
          ) : null}
          <ul className={styles.taskList}>
            {attention.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className={styles.attention}>
                  <span className={`${styles.tag} ${item.tone}`}>{item.tag}</span>
                  <span className={styles.taskName}>{item.name}</span>
                  <span className={styles.muted}>{item.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2>Calls per day</h2>
          <span className={styles.muted}>Last 7 days, whole team</span>
        </div>
        <DayColumns label="Calls per day" rows={data.callsPerDay} />
      </section>
    </>
  );
}

const STAGE_TONES: Record<string, string> = {
  NEW: styles.toneNew,
  CONTACTED: styles.toneContacted,
  QUALIFIED: styles.toneQualified,
  QUOTED: styles.toneQuoted,
  WON: styles.toneWon,
  LOST: styles.toneLost,
};
const SOURCE_TONES: Record<string, string> = {
  WHATSAPP: styles.srcWhatsapp,
  AD: styles.srcAd,
  WEBSITE: styles.srcWebsite,
  PHONE: styles.srcPhone,
  MANUAL: styles.srcManual,
  IMPORT: styles.srcImport,
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A calendar month `back` months before today's: its first day, its last (or today), its name. */
function monthRange(today: string, back: number) {
  const [year, month] = today.split("-").map(Number);
  const index = year * 12 + (month - 1) - back;
  const first = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
  const nextIndex = index + 1;
  const nextFirst = `${Math.floor(nextIndex / 12)}-${String((nextIndex % 12) + 1).padStart(2, "0")}-01`;
  return {
    from: first,
    to: back === 0 ? today : addBusinessDays(nextFirst, -1),
    name: MONTH_NAMES[index % 12],
  };
}

function AdminView({ data }: { data: Dashboard }) {
  const [month, setMonth] = useState<0 | 1>(0);
  const [report, setReport] = useState<Report | null>(null);
  const [previous, setPrevious] = useState<Report | null>(null);
  const [teams, setTeams] = useState<Array<{ team: Team; report: Report }>>([]);
  const [error, setError] = useState<FriendlyError | null>(null);
  const { can } = usePrincipal();
  const seesTeams = can("teams:view");
  const now = monthRange(data.today, month);
  const before = monthRange(data.today, month + 1);

  useEffect(() => {
    const controller = new AbortController();
    const ask = (range: { from: string; to: string }, teamId?: string) =>
      apiRequest<Report>(
        `/api/reports?${new URLSearchParams({ from: range.from, to: range.to, ...(teamId ? { teamId } : {}) })}`,
        { signal: controller.signal },
      );
    Promise.all([ask(now), ask(before)]).then(([current, last]) => {
      if (controller.signal.aborted) return;
      if (current.ok) setReport(current.data);
      else setError(current.error);
      setPrevious(last.ok ? last.data : null);
    });
    if (seesTeams) {
      apiRequest<Team[]>("/api/teams", { signal: controller.signal }).then(async (result) => {
        if (!result.ok || controller.signal.aborted) return;
        const rows = await Promise.all(
          result.data.map(async (team) => {
            const answer = await ask(now, team.id);
            return answer.ok ? { team, report: answer.data } : null;
          }),
        );
        if (!controller.signal.aborted) {
          setTeams(rows.filter((row): row is { team: Team; report: Report } => row !== null));
        }
      });
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ranges follow `month` and the day
  }, [month, data.today, seesTeams]);

  const totals = report?.totals;
  const delta = (current: number, last: number | undefined, unit: "%" | "") => {
    if (last === undefined) return undefined;
    if (unit === "%") {
      if (last === 0) return undefined;
      const change = Math.round(((current - last) / last) * 100);
      return `${change >= 0 ? "+" : ""}${change}% vs ${before.name}`;
    }
    const change = current - last;
    return `${change >= 0 ? "+" : ""}${change} vs ${before.name}`;
  };
  const sources = report?.sources ?? [];
  const sourceTotal = sources.reduce((sum, row) => sum + row.count, 0);
  const topDestination = Math.max(1, ...(report?.destinations ?? []).map((row) => row.count));
  const funnelTotal = totals?.leads ?? 0;
  const lostStage = report?.stages.find((stage) => stage.kind === "LOST");

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.muted}>
            {formatBusinessDate(now.from, "date")} – {formatBusinessDate(now.to, "date")} · all
            teams
          </span>
          <h1 className={styles.title}>
            Company <span className={styles.accent}>overview</span>
          </h1>
        </div>
        <div className={styles.segments} role="group" aria-label="Period">
          <button
            type="button"
            className={styles.segment}
            aria-pressed={month === 0}
            onClick={() => setMonth(0)}
          >
            This month
          </button>
          <button
            type="button"
            className={styles.segment}
            aria-pressed={month === 1}
            onClick={() => setMonth(1)}
          >
            Last month
          </button>
        </div>
      </div>
      {error ? <ErrorMessage error={error} /> : null}
      <div className={styles.tiles}>
        {data.queue !== null ? (
          <Tile
            label="Unassigned now"
            value={data.queue}
            note="Open queue →"
            href="/queue"
            tone="dark"
          />
        ) : null}
        <Tile
          label="New leads"
          value={totals?.leads ?? "—"}
          note={totals ? delta(totals.leads, previous?.totals.leads, "%") : undefined}
          tone={totals && previous && totals.leads >= previous.totals.leads ? "good" : undefined}
        />
        <Tile
          label="Booked"
          value={totals?.won ?? "—"}
          note={totals ? delta(totals.won, previous?.totals.won, "") : undefined}
          tone={totals && previous && totals.won >= previous.totals.won ? "good" : undefined}
        />
        <Tile
          label="Booking value"
          value={totals ? rupees(totals.value) : "—"}
          note={
            totals && totals.won > 0
              ? `Avg ${rupees(Number(totals.value) / totals.won)}`
              : undefined
          }
        />
        <Tile
          label="First reply, median"
          value={minutesLabel(report?.response.median ?? null)}
          note={report ? `Target ${report.response.targetMinutes} min` : undefined}
        />
        <Tile
          label="Missed first-reply target"
          value={report?.response.missed ?? "—"}
          note={
            report && totals
              ? `${percent(report.response.missed, totals.leads)}% of leads`
              : undefined
          }
          tone={report?.response.missed ? "bad" : undefined}
        />
      </div>
      <div className={styles.columnsWide}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Conversion funnel</h2>
            <span className={styles.muted}>Leads created in this period, where they are now</span>
          </div>
          {report?.stages.map((stage) => (
            <div key={stage.code} className={styles.funnelRow}>
              <span className={styles.funnelLabel}>
                <span className={`${styles.funnelDot} ${STAGE_TONES[stage.code] ?? ""}`} />
                {stage.name}
              </span>
              <span className={styles.funnelTrack}>
                <span
                  className={`${styles.funnelFill} ${STAGE_TONES[stage.code] ?? ""}`}
                  style={{ width: `${funnelTotal ? (stage.count / funnelTotal) * 100 : 0}%` }}
                />
              </span>
              <span className={styles.funnelValue}>
                <strong>{stage.count}</strong> {Math.round(percent(stage.count, funnelTotal))}%
              </span>
            </div>
          ))}
          {totals ? (
            <p className={styles.muted}>
              Booked {totals.won} of {totals.leads} ({totals.conversionPercent}%).
              {lostStage ? ` Lost ${totals.lost}.` : ""}
            </p>
          ) : null}
        </section>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Leads by source</h2>
          </div>
          {sourceTotal > 0 ? (
            <>
              <div
                className={styles.stacked}
                role="img"
                aria-label={sources
                  .map(
                    (row) =>
                      `${SOURCE_NAMES[row.source] ?? row.source} ${Math.round(percent(row.count, sourceTotal))}%`,
                  )
                  .join(", ")}
              >
                {sources.map((row) => (
                  <span
                    key={row.source}
                    className={`${styles.stackPart} ${SOURCE_TONES[row.source] ?? ""}`}
                    style={{ width: `${(row.count / sourceTotal) * 100}%` }}
                    title={`${SOURCE_NAMES[row.source] ?? row.source}: ${row.count}`}
                  />
                ))}
              </div>
              <div className={styles.legend}>
                {sources.map((row) => (
                  <span key={row.source} className={styles.legendItem}>
                    <span className={`${styles.legendSwatch} ${SOURCE_TONES[row.source] ?? ""}`} />
                    {SOURCE_NAMES[row.source] ?? row.source} · {row.count} (
                    {Math.round(percent(row.count, sourceTotal))}%)
                  </span>
                ))}
              </div>
            </>
          ) : (
            <span className={styles.muted}>No leads in this period yet.</span>
          )}
          <h2 className={styles.subhead}>Top destinations</h2>
          {(report?.destinations ?? []).slice(0, 6).map((row) => (
            <div
              key={row.destination}
              className={styles.hRow}
              title={`${row.destination}: ${row.count}`}
            >
              <span>{row.destination}</span>
              <span className={styles.hTrack}>
                <span
                  className={styles.hFillSoft}
                  style={{ width: `${(row.count / topDestination) * 100}%` }}
                />
              </span>
              <span className={styles.hValue}>{row.count}</span>
            </div>
          ))}
        </section>
      </div>
      {teams.length > 0 ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Team comparison</h2>
            <Link href="/reports" className={styles.cardLink}>
              Full report
            </Link>
          </div>
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Team comparison">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Leads</th>
                  <th>First reply</th>
                  <th>Booked</th>
                  <th>Conversion</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {teams.map(({ team, report: row }) => (
                  <tr key={team.id}>
                    <td>
                      <strong>{team.name}</strong>
                      {team.manager ? (
                        <span className={styles.muted}> · {team.manager.name}</span>
                      ) : null}
                    </td>
                    <td>{row.totals.leads}</td>
                    <td>{minutesLabel(row.response.median)}</td>
                    <td>{row.totals.won}</td>
                    <td>{row.totals.conversionPercent}%</td>
                    <td>{rupees(row.totals.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

export function DashboardPage() {
  const { state, can } = usePrincipal();
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

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
  }, [state, range, attempt]);

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

  return (
    <main className={styles.page}>
      {data.scope === "own" ? (
        <AgentView data={data} range={range} setRange={setRange} reload={reload} />
      ) : data.scope === "all" && can("reports:view") ? (
        <>
          <AdminView data={data} />
          <UpNextList tasks={data.upNext} showAssignee canComplete={false} onDone={reload} />
        </>
      ) : (
        <ManagerView data={data} range={range} setRange={setRange} />
      )}
      {help}
    </main>
  );
}
