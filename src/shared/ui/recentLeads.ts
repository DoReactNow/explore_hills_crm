// "Recently opened" in the sidebar (owner's design). Kept in this browser only, per person, and holds
// what the person already saw on screen: a lead's id, name and destination.
const KEY = "eh.recentLeads";
const LIMIT = 3;
export const RECENT_LEADS_EVENT = "eh:recent-leads";

export interface RecentLead {
  id: string;
  name: string;
  destination: string | null;
}

function keyFor(userId: string) {
  return `${KEY}.${userId}`;
}

export function readRecentLeads(userId: string): RecentLead[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(keyFor(userId)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is RecentLead =>
              typeof item?.id === "string" && typeof item?.name === "string",
          )
          .slice(0, LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function rememberRecentLead(userId: string, lead: RecentLead) {
  try {
    const next = [lead, ...readRecentLeads(userId).filter((item) => item.id !== lead.id)].slice(
      0,
      LIMIT,
    );
    window.localStorage.setItem(keyFor(userId), JSON.stringify(next));
    window.dispatchEvent(new Event(RECENT_LEADS_EVENT));
  } catch {
    // storage is a convenience; without it the list just stays empty
  }
}

/** Drops one lead, e.g. once its customer's details were erased. */
export function forgetRecentLead(userId: string, leadId: string) {
  try {
    const kept = readRecentLeads(userId).filter((item) => item.id !== leadId);
    window.localStorage.setItem(keyFor(userId), JSON.stringify(kept));
    window.dispatchEvent(new Event(RECENT_LEADS_EVENT));
  } catch {
    // nothing to do
  }
}

/** On signing out, so a shared computer keeps no customer names. */
export function forgetAllRecentLeads() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(`${KEY}.`)) window.localStorage.removeItem(key);
    }
  } catch {
    // nothing to do
  }
}
