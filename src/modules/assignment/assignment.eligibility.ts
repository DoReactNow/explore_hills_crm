// Who can take a lead right now, and when a response falls due (Decision 59). Pure: everything is
// passed in. A shift's start minute is inside it and its end minute is outside. A shift whose end
// is not after its start crosses midnight and belongs to the day it started.
import {
  addBusinessDays,
  businessMoment,
  businessWeekday,
  instantFromEpochMs,
  parseBusinessLocalDateTime,
  type BusinessDate,
} from "@/shared/time";

export interface Shift {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  isAvailable: boolean;
  /** The agent's own cap, or else the system default. Zero means no leads. */
  cap: number;
  tier: number;
  languages: readonly string[];
  destinations: readonly string[];
  leaveFrom: BusinessDate | null;
  leaveTo: BusinessDate | null;
  shifts: readonly Shift[];
  openLeads: number;
  lastAssignedAt: Date | null;
}

export type AgentBlock = "unavailable" | "on_leave" | "off_shift" | "at_cap";

const MINUTES_IN_DAY = 1440;
const MS_IN_MINUTE = 60_000;

const crossesMidnight = (shift: Shift) => shift.endMinute <= shift.startMinute;
const previousWeekday = (weekday: number) => (weekday + 6) % 7;

/** The shift's day, when `at` is in the part of an overnight shift after midnight. */
function inOvernightTail(shifts: readonly Shift[], weekday: number, minute: number) {
  return shifts.some(
    (shift) =>
      crossesMidnight(shift) &&
      shift.weekday === previousWeekday(weekday) &&
      minute < shift.endMinute,
  );
}

export function isOnShift(shifts: readonly Shift[], at: Date): boolean {
  const { weekday, minute } = businessMoment(at);
  if (inOvernightTail(shifts, weekday, minute)) return true;
  return shifts.some(
    (shift) =>
      shift.weekday === weekday &&
      minute >= shift.startMinute &&
      (crossesMidnight(shift) || minute < shift.endMinute),
  );
}

/** The day that counts for leave: the starting day during the tail of an overnight shift. */
function workingDay(shifts: readonly Shift[], at: Date): BusinessDate {
  const { date, weekday, minute } = businessMoment(at);
  return inOvernightTail(shifts, weekday, minute) ? addBusinessDays(date, -1) : date;
}

/** Why this agent can't take a lead right now, or null if they can. */
export function agentBlock(agent: AgentProfile, at: Date): AgentBlock | null {
  if (!agent.isAvailable) return "unavailable";
  if (agent.leaveFrom && agent.leaveTo) {
    const day = workingDay(agent.shifts, at);
    if (day >= agent.leaveFrom && day <= agent.leaveTo) return "on_leave";
  }
  if (agent.shifts.length > 0 && !isOnShift(agent.shifts, at)) return "off_shift";
  if (agent.openLeads >= agent.cap) return "at_cap";
  return null;
}

const listAllows = (list: readonly string[], value: string | null) =>
  !value || list.length === 0 || list.some((item) => item.toLowerCase() === value.toLowerCase());

/** An empty list means anything, and a lead with no value can go to anyone. */
export function matchesLead(
  agent: Pick<AgentProfile, "languages" | "destinations">,
  lead: { language: string | null; destination: string | null },
): boolean {
  return (
    listAllows(agent.languages, lead.language) && listAllows(agent.destinations, lead.destination)
  );
}

/**
 * When `minutes` of the agent's shift time will have passed. With no shifts, plain time. Worked out
 * once, at assignment, so later changes to a setting or a shift don't move it.
 */
export function responseDeadline(start: Date, minutes: number, shifts: readonly Shift[]): Date {
  if (shifts.length === 0) return instantFromEpochMs(start.getTime() + minutes * MS_IN_MINUTE);

  let remaining = minutes * MS_IN_MINUTE;
  let cursor = start.getTime();
  // From yesterday, because yesterday's overnight shift may still be running.
  let day = addBusinessDays(businessMoment(start).date, -1);
  for (;;) {
    const weekday = businessWeekday(day);
    const today = shifts
      .filter((shift) => shift.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);
    const midnight = parseBusinessLocalDateTime(day, "00:00").getTime();
    for (const shift of today) {
      const end = crossesMidnight(shift) ? shift.endMinute + MINUTES_IN_DAY : shift.endMinute;
      const from = Math.max(cursor, midnight + shift.startMinute * MS_IN_MINUTE);
      const to = midnight + end * MS_IN_MINUTE;
      if (to <= from) continue;
      if (to - from >= remaining) return instantFromEpochMs(from + remaining);
      remaining -= to - from;
      cursor = to;
    }
    day = addBusinessDays(day, 1);
  }
}
