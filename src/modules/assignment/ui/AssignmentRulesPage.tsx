"use client";

// Assignment rules: the timers, the auto-assign rule, and each agent's cap, tier, shifts (in the
// business timezone), leave, languages and destinations.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { AUTO_MODES, type AutoMode } from "../assignment.types";
import styles from "./assignment.module.css";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AUTO_LABELS: Record<AutoMode, string> = {
  ROUND_ROBIN: "Round-robin",
  LEAST_LOADED: "Least busy",
  PRIORITY: "By priority",
  RANDOM: "Random",
};

interface Shift {
  weekday: number;
  startMinute: number;
  endMinute: number;
}
interface Agent {
  id: string;
  name: string;
  isAvailable: boolean;
  cap: number;
  tier: number;
  languages: string[];
  destinations: string[];
  leaveFrom: string | null;
  leaveTo: string | null;
  shifts: Shift[];
  openLeads: number;
  block: string | null;
}
interface Data {
  items: Agent[];
  defaultCap: number;
  timeoutMinutes: number;
  poolExpiryMinutes: number;
  maxTimeouts: number;
}
interface AutoRule {
  enabled: boolean;
  mode: AutoMode;
  priorityBy: "tier" | "value";
}

const toTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const toMinute = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
const toList = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function AgentEditor({
  agent,
  defaultCap,
  onSaved,
}: {
  agent: Agent;
  defaultCap: number;
  onSaved: () => void;
}) {
  const [available, setAvailable] = useState(agent.isAvailable);
  const [cap, setCap] = useState(agent.cap === defaultCap ? "" : String(agent.cap));
  const [tier, setTier] = useState(String(agent.tier));
  const [languages, setLanguages] = useState(agent.languages.join(", "));
  const [destinations, setDestinations] = useState(agent.destinations.join(", "));
  const [leaveFrom, setLeaveFrom] = useState(agent.leaveFrom ?? "");
  const [leaveTo, setLeaveTo] = useState(agent.leaveTo ?? "");
  const [shifts, setShifts] = useState<Shift[]>(
    agent.shifts.map(({ weekday, startMinute, endMinute }) => ({
      weekday,
      startMinute,
      endMinute,
    })),
  );
  const [error, setError] = useState<FriendlyError | null>(null);
  const [saved, setSaved] = useState(false);

  const changeShift = (index: number, change: Partial<Shift>) =>
    setShifts((now) => now.map((shift, i) => (i === index ? { ...shift, ...change } : shift)));

  async function save() {
    setSaved(false);
    setError(null);
    const result = await apiRequest(`/api/assignment/agents/${agent.id}`, {
      method: "PUT",
      body: {
        isAvailable: available,
        openLeadCap: cap === "" ? null : Number(cap),
        priorityTier: Number(tier) || 0,
        languages: toList(languages),
        destinations: toList(destinations),
        leaveFromDate: leaveFrom || null,
        leaveToDate: leaveTo || null,
        shifts,
      },
    });
    if (result.ok) {
      setSaved(true);
      onSaved();
    } else setError(result.error);
  }

  return (
    <section className={styles.section} aria-label={agent.name}>
      <div className={styles.cardRow}>
        <h2>{agent.name}</h2>
        <span className={styles.muted}>
          {agent.openLeads} of {agent.cap} open
        </span>
        <label className={styles.right}>
          <input
            type="checkbox"
            checked={available}
            onChange={(event) => setAvailable(event.target.checked)}
          />{" "}
          Available
        </label>
      </div>
      {error ? <ErrorMessage error={error} /> : null}
      <div className={styles.form}>
        <label className={styles.field}>
          Open-lead cap
          <input
            className={styles.input}
            type="number"
            min={0}
            placeholder={`Default (${defaultCap})`}
            value={cap}
            onChange={(event) => setCap(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Tier (higher is served first)
          <input
            className={styles.input}
            type="number"
            min={0}
            value={tier}
            onChange={(event) => setTier(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Languages (commas between)
          <input
            className={styles.input}
            value={languages}
            onChange={(event) => setLanguages(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Destinations (commas between)
          <input
            className={styles.input}
            value={destinations}
            onChange={(event) => setDestinations(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Leave from
          <input
            className={styles.input}
            type="date"
            value={leaveFrom}
            onChange={(event) => setLeaveFrom(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Leave to
          <input
            className={styles.input}
            type="date"
            value={leaveTo}
            onChange={(event) => setLeaveTo(event.target.value)}
          />
        </label>
      </div>
      <span className={styles.muted}>
        Shifts (IST). A shift that ends earlier than it starts runs overnight and counts toward the
        day it started. With no shifts, the agent is always on.
      </span>
      {shifts.map((shift, index) => (
        <div key={index} className={styles.shift}>
          <select
            aria-label="Day"
            className={styles.input}
            value={shift.weekday}
            onChange={(event) => changeShift(index, { weekday: Number(event.target.value) })}
          >
            {WEEKDAYS.map((day, value) => (
              <option key={day} value={value}>
                {day}
              </option>
            ))}
          </select>
          <input
            aria-label="Starts"
            className={styles.input}
            type="time"
            value={toTime(shift.startMinute)}
            onChange={(event) => changeShift(index, { startMinute: toMinute(event.target.value) })}
          />
          –
          <input
            aria-label="Ends"
            className={styles.input}
            type="time"
            value={toTime(shift.endMinute)}
            onChange={(event) => changeShift(index, { endMinute: toMinute(event.target.value) })}
          />
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setShifts((now) => now.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() =>
            setShifts((now) => [...now, { weekday: 1, startMinute: 540, endMinute: 1080 }])
          }
        >
          + Add a shift
        </button>
        <span className={styles.spacer} />
        {saved ? (
          <span role="status" className={styles.muted}>
            Saved.
          </span>
        ) : null}
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          style={{ flex: "none" }}
          onClick={save}
        >
          Save {agent.name}
        </button>
      </div>
    </section>
  );
}

export function AssignmentRulesPage() {
  const access = usePageAccess("assignment:manage-rules");
  const { can } = usePrincipal();
  const [data, setData] = useState<Data | null>(null);
  const [rule, setRule] = useState<AutoRule | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [ruleSaved, setRuleSaved] = useState(false);

  const load = useCallback(async () => {
    const [agents, auto] = await Promise.all([
      apiRequest<Data>("/api/assignment/agents"),
      apiRequest<AutoRule>("/api/assignment/auto-rule"),
    ]);
    if (agents.ok) setData(agents.data);
    else setError(agents.error);
    if (auto.ok) setRule(auto.data);
  }, []);

  useEffect(() => {
    if (access !== "allowed") return;
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [access, load]);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed") {
    return (
      <main className={styles.page}>
        <h1 className={styles.headline}>Assignment rules</h1>
        <ErrorMessage error={access} />
      </main>
    );
  }

  async function saveRule(next: AutoRule) {
    setRule(next);
    setRuleSaved(false);
    const result = await apiRequest<AutoRule>("/api/assignment/auto-rule", {
      method: "PUT",
      body: next,
    });
    if (result.ok) setRuleSaved(true);
    else setError(result.error);
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.headline}>Assignment rules</h1>
      {error ? <ErrorMessage error={error} /> : null}
      {data ? (
        <section className={styles.section}>
          <h2>Timers &amp; limits</h2>
          <span>
            Response timeout: {data.timeoutMinutes} min, counted during the agent&apos;s shift
          </span>
          <span>Blast offer: {data.poolExpiryMinutes} min</span>
          <span>Default open-lead cap: {data.defaultCap}</span>
          <span>Flag for a manager after {data.maxTimeouts} timeouts in a row</span>
          {can("settings:manage") ? (
            <Link href="/settings">Change these in Settings</Link>
          ) : (
            <span className={styles.muted}>An Admin can change these in Settings.</span>
          )}
        </section>
      ) : null}
      {rule ? (
        <section className={styles.section}>
          <h2>Auto-assign</h2>
          <label>
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(event) => saveRule({ ...rule, enabled: event.target.checked })}
            />{" "}
            Assign new leads automatically, within about a minute of arriving
          </label>
          <label className={styles.field}>
            How
            <select
              className={styles.input}
              value={rule.mode}
              onChange={(event) => saveRule({ ...rule, mode: event.target.value as AutoMode })}
            >
              {AUTO_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {AUTO_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          <span className={styles.muted}>
            It applies to each new lead once, and never to a lead a manager is handling.
            {ruleSaved ? " Saved." : ""}
          </span>
        </section>
      ) : null}
      {data?.items.length === 0 ? <p className={styles.muted}>No agents yet.</p> : null}
      {data?.items.map((agent) => (
        <AgentEditor key={agent.id} agent={agent} defaultCap={data.defaultCap} onSaved={load} />
      ))}
    </main>
  );
}
