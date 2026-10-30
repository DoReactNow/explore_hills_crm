// P5-ELIG and P5-TIMEOUT-09: who can take a lead right now, and when a response is due.
import { describe, expect, it } from "vitest";
import { parseBusinessLocalDateTime, type BusinessDate } from "@/shared/time";
import {
  agentBlock,
  isOnShift,
  matchesLead,
  responseDeadline,
  type AgentProfile,
} from "../assignment.eligibility";

// 2026-11-02 is a Monday.
const at = (date: string, time: string) => parseBusinessLocalDateTime(date, time);
const MON = 1;
const TUE = 2;

const agent = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id: "a",
  name: "Anil",
  isAvailable: true,
  cap: 12,
  tier: 0,
  languages: [],
  destinations: [],
  leaveFrom: null,
  leaveTo: null,
  shifts: [],
  openLeads: 0,
  lastAssignedAt: null,
  ...overrides,
});
const leave = (from: string, to: string) => ({
  leaveFrom: from as BusinessDate,
  leaveTo: to as BusinessDate,
});
const nineToSix = { weekday: MON, startMinute: 540, endMinute: 1080 };
const overnight = { weekday: MON, startMinute: 1320, endMinute: 360 };

describe("shifts", () => {
  it("means always available when none are set (P5-ELIG-03)", () => {
    expect(agentBlock(agent(), at("2026-11-02", "03:00"))).toBeNull();
  });

  it("skips an agent off shift (P5-ELIG-03)", () => {
    expect(agentBlock(agent({ shifts: [nineToSix] }), at("2026-11-02", "08:00"))).toBe("off_shift");
  });

  it("counts the start minute in and the end minute out (P5-ELIG-04)", () => {
    expect(isOnShift([nineToSix], at("2026-11-02", "08:59"))).toBe(false);
    expect(isOnShift([nineToSix], at("2026-11-02", "09:00"))).toBe(true);
    expect(isOnShift([nineToSix], at("2026-11-02", "17:59"))).toBe(true);
    expect(isOnShift([nineToSix], at("2026-11-02", "18:00"))).toBe(false);
  });

  it("carries an overnight shift into the next morning only (P5-ELIG-04)", () => {
    expect(isOnShift([overnight], at("2026-11-02", "21:59"))).toBe(false);
    expect(isOnShift([overnight], at("2026-11-02", "22:00"))).toBe(true);
    expect(isOnShift([overnight], at("2026-11-03", "05:59"))).toBe(true);
    expect(isOnShift([overnight], at("2026-11-03", "06:00"))).toBe(false);
    // It belongs to Monday, so early Monday is not part of it.
    expect(isOnShift([overnight], at("2026-11-02", "02:00"))).toBe(false);
  });
});

describe("leave", () => {
  it("includes the first and last day in the business timezone (P5-ELIG-02)", () => {
    const onLeave = agent(leave("2026-11-02", "2026-11-03"));
    expect(agentBlock(onLeave, at("2026-11-01", "23:59"))).toBeNull();
    expect(agentBlock(onLeave, at("2026-11-02", "00:00"))).toBe("on_leave");
    expect(agentBlock(onLeave, at("2026-11-03", "23:59"))).toBe("on_leave");
    expect(agentBlock(onLeave, at("2026-11-04", "00:00"))).toBeNull();
  });

  it("checks the day an overnight shift started (Decision 59)", () => {
    // Leave starts Tuesday. Early Tuesday is still Monday's shift, so they can take leads.
    const fromTuesday = agent({ shifts: [overnight], ...leave("2026-11-03", "2026-11-05") });
    expect(agentBlock(fromTuesday, at("2026-11-03", "02:00"))).toBeNull();
    // Leave ended Monday. Early Tuesday is still part of Monday's shift, so they can't.
    const untilMonday = agent({ shifts: [overnight], ...leave("2026-11-01", "2026-11-02") });
    expect(agentBlock(untilMonday, at("2026-11-03", "02:00"))).toBe("on_leave");
  });
});

describe("caps and availability", () => {
  it("skips an agent at their cap (P5-ELIG-05)", () => {
    const now = at("2026-11-02", "12:00");
    expect(agentBlock(agent({ cap: 2, openLeads: 1 }), now)).toBeNull();
    expect(agentBlock(agent({ cap: 2, openLeads: 2 }), now)).toBe("at_cap");
    expect(agentBlock(agent({ cap: 0 }), now)).toBe("at_cap");
  });

  it("skips an agent marked unavailable", () => {
    expect(agentBlock(agent({ isAvailable: false }), at("2026-11-02", "12:00"))).toBe(
      "unavailable",
    );
  });
});

describe("language and destination (P5-ELIG-06)", () => {
  const specialist = agent({ languages: ["Hindi"], destinations: ["Ladakh"] });

  it("matches in any case", () => {
    expect(matchesLead(specialist, { language: "hindi", destination: "LADAKH" })).toBe(true);
    expect(matchesLead(specialist, { language: "Tamil", destination: "Ladakh" })).toBe(false);
    expect(matchesLead(specialist, { language: "Hindi", destination: "Goa" })).toBe(false);
  });

  it("lets a lead with neither go to anyone", () => {
    expect(matchesLead(specialist, { language: null, destination: null })).toBe(true);
  });

  it("treats an empty list as anything", () => {
    expect(matchesLead(agent(), { language: "Tamil", destination: "Goa" })).toBe(true);
  });
});

describe("responseDeadline (Q-11)", () => {
  it("is plain time for an agent with no shifts", () => {
    expect(responseDeadline(at("2026-11-02", "23:50"), 30, [])).toEqual(at("2026-11-03", "00:20"));
  });

  it("counts inside one shift", () => {
    expect(responseDeadline(at("2026-11-02", "10:00"), 30, [nineToSix])).toEqual(
      at("2026-11-02", "10:30"),
    );
  });

  it("pauses when the shift ends and resumes at the next", () => {
    const shifts = [nineToSix, { weekday: TUE, startMinute: 540, endMinute: 1080 }];
    expect(responseDeadline(at("2026-11-02", "17:50"), 30, shifts)).toEqual(
      at("2026-11-03", "09:20"),
    );
  });

  it("starts at the next shift when assigned off shift", () => {
    expect(responseDeadline(at("2026-11-02", "07:00"), 30, [nineToSix])).toEqual(
      at("2026-11-02", "09:30"),
    );
  });

  it("wraps to the same weekday next week", () => {
    expect(responseDeadline(at("2026-11-02", "19:00"), 30, [nineToSix])).toEqual(
      at("2026-11-09", "09:30"),
    );
  });

  it("runs through midnight in an overnight shift", () => {
    expect(responseDeadline(at("2026-11-02", "23:50"), 30, [overnight])).toEqual(
      at("2026-11-03", "00:20"),
    );
    expect(responseDeadline(at("2026-11-03", "05:50"), 30, [overnight])).toEqual(
      at("2026-11-09", "22:20"),
    );
  });

  it("does not count time twice when one shift runs on past another's end", () => {
    const shifts = [nineToSix, { weekday: MON, startMinute: 1020, endMinute: 1110 }];
    expect(responseDeadline(at("2026-11-02", "17:50"), 30, shifts)).toEqual(
      at("2026-11-02", "18:20"),
    );
  });

  it("does not count overlapping shifts twice", () => {
    const shifts = [nineToSix, { weekday: MON, startMinute: 600, endMinute: 660 }];
    expect(responseDeadline(at("2026-11-02", "10:00"), 60, shifts)).toEqual(
      at("2026-11-02", "11:00"),
    );
  });
});
