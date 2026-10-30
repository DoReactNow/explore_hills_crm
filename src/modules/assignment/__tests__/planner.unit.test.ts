// P5-MODE: who gets what in each mode.
import { describe, expect, it } from "vitest";
import { instantFromEpochMs } from "@/shared/time";
import type { AgentProfile } from "../assignment.eligibility";
import { planAssignment, type PlanLead } from "../assignment.planner";

const agent = (id: string, overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id,
  name: id,
  isAvailable: true,
  cap: 100,
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
const lead = (id: string, overrides: Partial<PlanLead> = {}): PlanLead => ({
  id,
  language: null,
  destination: null,
  budget: null,
  createdAt: instantFromEpochMs(Number(id.replace(/\D/g, "")) * 1000),
  ...overrides,
});
const leads = (count: number) => Array.from({ length: count }, (_, i) => lead(`l${i + 1}`));
const countsOf = (rows: Array<{ userId: string }>) =>
  rows.reduce<Record<string, number>>(
    (all, row) => ({ ...all, [row.userId]: (all[row.userId] ?? 0) + 1 }),
    {},
  );
const when = (ms: number) => instantFromEpochMs(ms);

describe("MANUAL (P5-MODE-01)", () => {
  it("gives every lead to the chosen agent", () => {
    const { rows, unplaced } = planAssignment({
      mode: "MANUAL",
      leads: leads(3),
      agents: [agent("a")],
    });
    expect(countsOf(rows)).toEqual({ a: 3 });
    expect(unplaced).toEqual([]);
  });
});

describe("ROUND_ROBIN (P5-MODE-02)", () => {
  it("keeps counts within one", () => {
    const { rows } = planAssignment({
      mode: "ROUND_ROBIN",
      leads: leads(7),
      agents: [agent("a"), agent("b"), agent("c")],
    });
    expect(Object.values(countsOf(rows)).sort()).toEqual([2, 2, 3]);
  });

  it("starts with whoever has waited longest, so batches rotate fairly", () => {
    const agents = [
      agent("recent", { lastAssignedAt: when(3000) }),
      agent("waiting", { lastAssignedAt: when(1000) }),
      agent("never"),
    ];
    const { rows } = planAssignment({ mode: "ROUND_ROBIN", leads: leads(3), agents });
    expect(rows.map((row) => row.userId)).toEqual(["never", "waiting", "recent"]);
  });

  it("skips an agent whose cap fills, without losing the lead", () => {
    const { rows, unplaced } = planAssignment({
      mode: "ROUND_ROBIN",
      leads: leads(4),
      agents: [agent("a", { cap: 1 }), agent("b")],
    });
    expect(countsOf(rows)).toEqual({ a: 1, b: 3 });
    expect(unplaced).toEqual([]);
  });
});

describe("LEAST_LOADED (P5-MODE-03)", () => {
  it("recounts during the batch", () => {
    const { rows } = planAssignment({
      mode: "LEAST_LOADED",
      leads: leads(4),
      agents: [agent("a", { openLeads: 3 }), agent("b", { openLeads: 0 })],
    });
    expect(countsOf(rows)).toEqual({ a: 1, b: 3 });
  });

  it("breaks ties by longest idle, with never-assigned first", () => {
    const agents = [
      agent("recent", { lastAssignedAt: when(3000) }),
      agent("idle", { lastAssignedAt: when(1000) }),
      agent("never"),
    ];
    const first = planAssignment({ mode: "LEAST_LOADED", leads: leads(1), agents });
    expect(first.rows[0].userId).toBe("never");
    const second = planAssignment({
      mode: "LEAST_LOADED",
      leads: leads(1),
      agents: agents.slice(0, 2),
    });
    expect(second.rows[0].userId).toBe("idle");
  });
});

describe("PRIORITY", () => {
  it("fills the highest tier to its cap, then overflows (P5-MODE-04)", () => {
    const { rows } = planAssignment({
      mode: "PRIORITY",
      leads: leads(4),
      agents: [agent("junior", { tier: 0 }), agent("senior", { tier: 2, cap: 3 })],
    });
    expect(countsOf(rows)).toEqual({ senior: 3, junior: 1 });
  });

  it("sends the highest value to the top agent, no budget last, ties oldest first (P5-MODE-05)", () => {
    const { rows } = planAssignment({
      mode: "PRIORITY",
      priorityBy: "value",
      leads: [
        lead("l1"),
        lead("l2", { budget: 100 }),
        lead("l3", { budget: 900 }),
        lead("l4", { budget: 100 }),
      ],
      agents: [agent("junior"), agent("senior", { tier: 1, cap: 2 })],
    });
    expect(rows).toEqual([
      { leadId: "l3", userId: "senior" },
      { leadId: "l2", userId: "senior" },
      { leadId: "l4", userId: "junior" },
      { leadId: "l1", userId: "junior" },
    ]);
  });
});

describe("RANDOM (P5-MODE-06)", () => {
  const input = {
    mode: "RANDOM" as const,
    leads: leads(20),
    agents: [agent("a"), agent("b"), agent("c")],
  };

  it("gives the same answer for the same seed", () => {
    expect(planAssignment({ ...input, seed: 7 })).toEqual(planAssignment({ ...input, seed: 7 }));
  });

  it("gives a different answer for another seed, among the given agents only", () => {
    const one = planAssignment({ ...input, seed: 7 });
    const two = planAssignment({ ...input, seed: 8 });
    expect(one.rows).not.toEqual(two.rows);
    expect(Object.keys(countsOf(one.rows)).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("every mode", () => {
  const modes = ["MANUAL", "ROUND_ROBIN", "LEAST_LOADED", "PRIORITY", "RANDOM"] as const;

  it.each(modes)("%s leaves the newest leads unplaced beyond capacity (P5-MODE-07)", (mode) => {
    const { rows, unplaced } = planAssignment({
      mode,
      seed: 1,
      leads: leads(5),
      agents: [agent("a", { cap: 3, openLeads: 1 })],
    });
    expect(rows.map((row) => row.leadId)).toEqual(["l1", "l2"]);
    expect(unplaced).toEqual(["l3", "l4", "l5"]);
  });

  it.each(modes)("%s works with one agent and one lead (P5-MODE-08)", (mode) => {
    const { rows } = planAssignment({ mode, seed: 1, leads: leads(1), agents: [agent("a")] });
    expect(rows).toEqual([{ leadId: "l1", userId: "a" }]);
  });

  it.each(modes)("%s honours language and destination", (mode) => {
    const { rows, unplaced } = planAssignment({
      mode,
      seed: 1,
      leads: [lead("l1", { destination: "Goa" }), lead("l2", { destination: "Ladakh" })],
      agents: [agent("a", { destinations: ["Goa"] })],
    });
    expect(rows).toEqual([{ leadId: "l1", userId: "a" }]);
    expect(unplaced).toEqual(["l2"]);
  });

  it("does nothing with no leads or no agents (P5-QUEUE-06)", () => {
    expect(planAssignment({ mode: "ROUND_ROBIN", leads: [], agents: [agent("a")] }).rows).toEqual(
      [],
    );
    expect(planAssignment({ mode: "ROUND_ROBIN", leads: leads(2), agents: [] })).toEqual({
      rows: [],
      unplaced: ["l1", "l2"],
    });
  });
});
