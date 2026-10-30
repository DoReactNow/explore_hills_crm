// Who gets what in each mode (Decision 59). Pure: the same input gives the same plan, so a preview
// can be trusted and tests can fix the random seed.
import { matchesLead, type AgentProfile } from "./assignment.eligibility";

export type PlanMode = "MANUAL" | "ROUND_ROBIN" | "LEAST_LOADED" | "PRIORITY" | "RANDOM";
export type PriorityBy = "tier" | "value";

export interface PlanLead {
  id: string;
  language: string | null;
  destination: string | null;
  budget: number | null;
  createdAt: Date;
}

export interface PlanInput {
  mode: PlanMode;
  /** Oldest first, so that the newest are the ones left in the queue. */
  leads: readonly PlanLead[];
  /** Only agents who can take leads right now. */
  agents: readonly AgentProfile[];
  priorityBy?: PriorityBy;
  seed?: number;
}

export interface PlanRow {
  leadId: string;
  userId: string;
}

interface Slot {
  agent: AgentProfile;
  load: number;
  lastTurn: number;
}

/** Longest idle first, and anyone never assigned before them. */
function byIdle(a: AgentProfile, b: AgentProfile): number {
  const idle = (a.lastAssignedAt?.getTime() ?? -1) - (b.lastAssignedAt?.getTime() ?? -1);
  return idle || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Highest budget first, no budget last, and equal values oldest first. */
function byValue(a: PlanLead, b: PlanLead): number {
  return (
    (b.budget ?? -1) - (a.budget ?? -1) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/** mulberry32: small, and repeatable for a seed. */
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

const leastLoaded = (a: Slot, b: Slot) => a.load - b.load || a.lastTurn - b.lastTurn;

export function planAssignment(input: PlanInput): { rows: PlanRow[]; unplaced: string[] } {
  const leads =
    input.mode === "PRIORITY" && input.priorityBy === "value"
      ? [...input.leads].sort(byValue)
      : input.leads;
  const slots: Slot[] = [...input.agents].sort(byIdle).map((agent, index) => ({
    agent,
    load: agent.openLeads,
    lastTurn: index - input.agents.length,
  }));
  const random = seededRandom(input.seed ?? 0);

  let turn = 0;
  let rotation = 0;
  const choose = (open: Slot[]): Slot => {
    switch (input.mode) {
      case "ROUND_ROBIN": {
        const start = rotation % slots.length;
        const next = [...slots.slice(start), ...slots.slice(0, start)].find((slot) =>
          open.includes(slot),
        ) as Slot;
        rotation = slots.indexOf(next) + 1;
        return next;
      }
      case "LEAST_LOADED":
        return [...open].sort(leastLoaded)[0];
      case "PRIORITY":
        return [...open].sort((a, b) => b.agent.tier - a.agent.tier || leastLoaded(a, b))[0];
      case "RANDOM":
        return open[Math.floor(random() * open.length)];
      case "MANUAL":
        return open[0];
    }
  };

  const rows: PlanRow[] = [];
  const unplaced: string[] = [];
  for (const lead of leads) {
    const open = slots.filter(
      (slot) => slot.load < slot.agent.cap && matchesLead(slot.agent, lead),
    );
    if (open.length === 0) {
      unplaced.push(lead.id);
      continue;
    }
    const slot = choose(open);
    slot.load += 1;
    slot.lastTurn = turn++;
    rows.push({ leadId: lead.id, userId: slot.agent.id });
  }
  return { rows, unplaced };
}
