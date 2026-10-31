"use client";

// Reports: filters in the URL, so a report can be shared and Back returns to it. Exports download the
// same figures as the tab on screen.
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { addBusinessDays, systemClock, todayBusinessDate } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { DayBars, RowBars } from "./charts";
import { dayLabel, minutesLabel, rupees } from "./format";
import styles from "./reporting.module.css";

const TABS = [
  { key: "volume", label: "Volume" },
  { key: "assignment", label: "Assignment" },
  { key: "response", label: "Response time" },
  { key: "funnel", label: "Conversion" },
  { key: "agents", label: "Agents" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const MODES: Record<string, string> = {
  MANUAL: "One agent",
  ROUND_ROBIN: "Round-robin",
  LEAST_LOADED: "Least busy",
  PRIORITY: "By priority",
  RANDOM: "Random",
  BLAST: "Blast",
};
const SOURCES: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
  MANUAL: "Manual",
  WEBSITE: "Website",
  AD: "Ad",
  IMPORT: "Import",
};

interface Report {
  totals: { leads: number; won: number; lost: number; value: string; conversionPercent: number };
  perDay: Array<{ day: string; count: number }>;
  stages: Array<{ code: string; name: string; count: number }>;
  sources: Array<{ source: string; count: number }>;
  destinations: Array<{ destination: string; count: number }>;
  modes: Array<{ mode: string; count: number }>;
  response: {
    targetMinutes: number;
    median: number | null;
    responded: number;
    noResponse: number;
    missed: number;
    withinTargetPercent: number;
    bands: Array<{ label: string; count: number }>;
  };
  agents: Array<{
    userId: string;
    name: string;
    deactivated: boolean;
    leads: number;
    firstReplyMedian: number | null;
    calls: number;
    quoted: number;
    won: number;
    value: string;
    conversionPercent: number;
  }>;
}

export function ReportsPage() {
  const access = usePageAccess("reports:view");
  const { can } = usePrincipal();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayBusinessDate(systemClock);
  const from = params.get("from") ?? addBusinessDays(today, -29);
  const to = params.get("to") ?? today;
  const teamId = params.get("teamId") ?? "";
  const source = params.get("source") ?? "";
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.some((item) => item.key === raw) ? raw : "volume";
  const [data, setData] = useState<Report | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<FriendlyError | null>(null);

  const query = new URLSearchParams({
    from,
    to,
    ...(teamId ? { teamId } : {}),
    ...(source ? { source } : {}),
  }).toString();

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    apiRequest<Report>(`/api/reports?${query}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else setError(result.error);
    });
    return () => controller.abort();
  }, [access, query]);

  useEffect(() => {
    if (access !== "allowed") return;
    const controller = new AbortController();
    apiRequest<{ teams: typeof teams }>("/api/reports/options", { signal: controller.signal }).then(
      (result) => {
        if (result.ok) setTeams(result.data.teams);
      },
    );
    return () => controller.abort();
  }, [access]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Reports</h1>
        <ErrorMessage error={access} />
      </main>
    );
  }

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`/reports?${next}`, { scroll: false });
  };

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Reports</h1>
      <div className={styles.controls}>
        <label className={styles.field}>
          From
          <input
            className={styles.input}
            type="date"
            value={from}
            onChange={(event) => update({ from: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          To
          <input
            className={styles.input}
            type="date"
            value={to}
            onChange={(event) => update({ to: event.target.value })}
          />
        </label>
        {teams.length > 0 ? (
          <label className={styles.field}>
            Team
            <select
              className={styles.input}
              value={teamId}
              onChange={(event) => update({ teamId: event.target.value })}
            >
              <option value="">All teams</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={styles.field}>
          Source
          <select
            className={styles.input}
            value={source}
            onChange={(event) => update({ source: event.target.value })}
          >
            <option value="">All sources</option>
            {Object.entries(SOURCES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {can("reports:export") ? (
          <>
            <a className={styles.button} href={`/api/reports/export?${query}&kind=${tab}`}>
              Export this tab
            </a>
            <a className={styles.button} href={`/api/reports/export?${query}&kind=leads`}>
              Export leads
            </a>
          </>
        ) : null}
      </div>
      <div role="tablist" className={styles.tabs}>
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={styles.tab}
            onClick={() => update({ tab: item.key })}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error ? <ErrorMessage error={error} /> : null}
      {!data && !error ? <p aria-busy="true">Loading…</p> : null}
      {data && !error ? (
        <>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>New leads</span>
              <span className={styles.tileValue}>{data.totals.leads}</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Booked</span>
              <span className={styles.tileValue}>{data.totals.won}</span>
              <span className={styles.tileNote}>{data.totals.conversionPercent}% of new leads</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Booking value</span>
              <span className={styles.tileValue}>{rupees(data.totals.value)}</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>First reply, median</span>
              <span className={styles.tileValue}>{minutesLabel(data.response.median)}</span>
            </div>
          </div>

          {tab === "volume" ? (
            <div className={styles.columns}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>Leads per day</h2>
                  <span className={styles.muted}>{data.totals.leads} leads</span>
                </div>
                <DayBars label="Leads per day" rows={data.perDay} dayLabel={dayLabel} />
              </section>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>By source</h2>
                </div>
                {data.sources.length === 0 ? (
                  <span className={styles.muted}>No leads in this period.</span>
                ) : null}
                <RowBars
                  rows={data.sources.map((row) => ({
                    label: SOURCES[row.source] ?? row.source,
                    count: row.count,
                  }))}
                />
                <div className={styles.cardHead}>
                  <h2>Top destinations</h2>
                </div>
                <RowBars
                  rows={data.destinations.map((row) => ({
                    label: row.destination,
                    count: row.count,
                  }))}
                />
              </section>
            </div>
          ) : null}

          {tab === "assignment" ? (
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2>How leads were assigned</h2>
              </div>
              {data.modes.length === 0 ? (
                <span className={styles.muted}>No assignments in this period.</span>
              ) : null}
              <RowBars
                rows={data.modes.map((row) => ({
                  label: MODES[row.mode] ?? row.mode,
                  count: row.count,
                }))}
              />
            </section>
          ) : null}

          {tab === "response" ? (
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2>First reply time</h2>
                <span className={styles.muted}>
                  In working hours · {data.response.withinTargetPercent}% within{" "}
                  {data.response.targetMinutes} min · {data.response.noResponse} with no reply ·{" "}
                  {data.response.missed} missed the target
                </span>
              </div>
              <RowBars rows={data.response.bands} />
            </section>
          ) : null}

          {tab === "funnel" ? (
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2>Conversion funnel</h2>
                <span className={styles.muted}>Leads from this period, where they are now</span>
              </div>
              {data.stages.length === 0 ? (
                <span className={styles.muted}>No leads in this period.</span>
              ) : null}
              <RowBars rows={data.stages.map((row) => ({ label: row.name, count: row.count }))} />
            </section>
          ) : null}

          {tab === "agents" ? (
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2>Per agent</h2>
              </div>
              {data.agents.length === 0 ? (
                <span className={styles.muted}>No leads in this period.</span>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Leads</th>
                        <th>First reply</th>
                        <th>Calls</th>
                        <th>At quote</th>
                        <th>Booked</th>
                        <th>Conversion</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.agents.map((row) => (
                        <tr key={row.userId}>
                          <td>
                            {row.name}
                            {row.deactivated ? " (left)" : ""}
                          </td>
                          <td>{row.leads}</td>
                          <td>{minutesLabel(row.firstReplyMedian)}</td>
                          <td>{row.calls}</td>
                          <td>{row.quoted}</td>
                          <td>{row.won}</td>
                          <td>{row.conversionPercent}%</td>
                          <td>{rupees(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
