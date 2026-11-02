"use client";

// Assignment rules: the timers, the auto-assign rule, and each agent's cap, tier, shifts (in the
// business timezone), leave, languages and destinations.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { Avatar } from "@/shared/ui/Avatar";
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

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const clock12 = (minute: number) => {
  const hours = Math.floor(minute / 60) % 24;
  const suffix = hours < 12 ? "am" : "pm";
  const shown = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = minute % 60;
  return minutes ? `${shown}:${String(minutes).padStart(2, "0")} ${suffix}` : `${shown} ${suffix}`;
};

/** The week at a glance (AssignRules design): each day's shifts, or Off. */
function WeekGrid({ shifts }: { shifts: Shift[] }) {
  if (shifts.length === 0) {
    return <span className={styles.muted}>No shifts set, so this agent counts as always on.</span>;
  }
  return (
    <div className={styles.week}>
      {WEEK_ORDER.map((day) => {
        const today = shifts.filter((shift) => shift.weekday === day);
        return (
          <div key={day} className={today.length ? styles.dayOn : styles.dayOff}>
            <span className={styles.dayName}>{DAY_SHORT[day]}</span>
            {today.length ? (
              today.map((shift, index) => (
                <span key={index} className={styles.dayTime}>
                  {clock12(shift.startMinute)}–{clock12(shift.endMinute)}
                </span>
              ))
            ) : (
              <span className={styles.dayTime}>Off</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Values as removable chips with "+ Add" (languages, destinations). */
function ChipInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const next = draft.trim();
    if (next && !values.some((value) => value.toLowerCase() === next.toLowerCase())) {
      onChange([...values, next]);
    }
    setDraft("");
  };
  return (
    <div className={styles.chipField} role="group" aria-label={label}>
      {values.map((value) => (
        <span key={value} className={styles.valueChip}>
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => onChange(values.filter((item) => item !== value))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        aria-label={`Add to ${label.toLowerCase()}`}
        className={styles.chipInput}
        placeholder="+ Add"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

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
  const [languages, setLanguages] = useState<string[]>(agent.languages);
  const [destinations, setDestinations] = useState<string[]>(agent.destinations);
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
        languages,
        destinations,
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
    <div className={styles.editor} role="group" aria-label={agent.name}>
      <div className={styles.cardRow}>
        <span className={styles.muted}>
          {agent.openLeads} of {agent.cap} open leads
        </span>
        <label className={styles.right}>
          <input
            type="checkbox"
            checked={available}
            onChange={(event) => setAvailable(event.target.checked)}
          />{" "}
          Taking new leads
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
      </div>
      <h3 className={styles.subTitle}>Shifts</h3>
      <WeekGrid shifts={shifts} />
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
      <button
        type="button"
        className={styles.linkButton}
        style={{ alignSelf: "flex-start" }}
        onClick={() =>
          setShifts((now) => [...now, { weekday: 1, startMinute: 540, endMinute: 1080 }])
        }
      >
        + Add a shift
      </button>
      <h3 className={styles.subTitle}>Leave</h3>
      <div className={styles.form}>
        <label className={styles.field}>
          From
          <input
            className={styles.input}
            type="date"
            value={leaveFrom}
            onChange={(event) => setLeaveFrom(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          To
          <input
            className={styles.input}
            type="date"
            value={leaveTo}
            onChange={(event) => setLeaveTo(event.target.value)}
          />
        </label>
      </div>
      <h3 className={styles.subTitle}>Languages</h3>
      <ChipInput label="Languages" values={languages} onChange={setLanguages} />
      <h3 className={styles.subTitle}>Destinations they’re best at</h3>
      <span className={styles.muted}>Matching leads go to them first.</span>
      <ChipInput label="Destinations" values={destinations} onChange={setDestinations} />
      <div className={styles.bar}>
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
    </div>
  );
}

export function AssignmentRulesPage() {
  const access = usePageAccess("assignment:manage-rules");
  const { can } = usePrincipal();
  const [data, setData] = useState<Data | null>(null);
  const [rule, setRule] = useState<AutoRule | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [ruleSaved, setRuleSaved] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

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

  const agents = data?.items ?? [];
  const chosen = agents.find((agent) => agent.id === selected) ?? agents[0] ?? null;
  const tiers = [...new Set(agents.map((agent) => agent.tier))].sort((a, b) => b - a);

  return (
    <main className={styles.page}>
      <h1 className={styles.headline}>Assignment rules</h1>
      {error ? <ErrorMessage error={error} /> : null}
      <div className={styles.rulesLayout}>
        <div className={styles.rulesColumn}>
          {data ? (
            <section className={styles.section}>
              <h2>Timers &amp; limits</h2>
              <dl className={styles.limits}>
                <div>
                  <dt>Reclaim if no reply</dt>
                  <dd>{data.timeoutMinutes} min</dd>
                </div>
                <div>
                  <dt>Blast offer expiry</dt>
                  <dd>{data.poolExpiryMinutes} min</dd>
                </div>
                <div>
                  <dt>Default open-lead cap</dt>
                  <dd>{data.defaultCap} leads</dd>
                </div>
                <div>
                  <dt>Flag for a manager after</dt>
                  <dd>{data.maxTimeouts} timeouts</dd>
                </div>
              </dl>
              <span className={styles.muted}>
                The reply timer counts only during the agent&apos;s shift.{" "}
                {can("settings:manage") ? (
                  <Link href="/settings">Change these in Settings</Link>
                ) : (
                  "An Admin can change these in Settings."
                )}
              </span>
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
          {agents.length > 0 ? (
            <section className={styles.section}>
              <div className={styles.cardRow}>
                <h2>Priority tiers</h2>
                <span className={`${styles.muted} ${styles.right}`}>
                  Higher tiers are served first
                </span>
              </div>
              {tiers.map((tier) => (
                <div key={tier} className={styles.tierRow}>
                  <span className={styles.tierName}>Tier {tier}</span>
                  <span className={styles.tierPeople}>
                    {agents
                      .filter((agent) => agent.tier === tier)
                      .map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          className={styles.personChip}
                          aria-pressed={chosen?.id === agent.id}
                          onClick={() => setSelected(agent.id)}
                        >
                          <Avatar name={agent.name} size={22} />
                          {agent.name}
                        </button>
                      ))}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
        </div>
        <div className={styles.rulesColumn}>
          {data && agents.length === 0 ? <p className={styles.muted}>No agents yet.</p> : null}
          {chosen && data ? (
            <div className={styles.agentPanel}>
              <div className={styles.cardRow}>
                <h2>Agent settings</h2>
                <label className={styles.right}>
                  <span className={styles.hiddenLabel}>Agent</span>
                  <select
                    className={styles.input}
                    value={chosen.id}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <AgentEditor
                key={chosen.id}
                agent={chosen}
                defaultCap={data.defaultCap}
                onSaved={load}
              />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
