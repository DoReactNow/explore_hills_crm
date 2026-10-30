// Whose leads a person may see (Decision 57). Resolved once per request and passed to the repository.
import { getVisibleAgentIds } from "@/modules/identity";
import type { Principal } from "@/shared/rbac/principal";
import { resolveScope, type ScopePermissions } from "@/shared/rbac/scope";
import type { LeadScope } from "./leads.repository";

export const LEAD_SCOPE: ScopePermissions = {
  own: "leads:view-own",
  team: "leads:view-team",
  all: "leads:view-all",
};

export async function leadScopeOf(principal: Principal): Promise<LeadScope> {
  const scope = resolveScope(principal, LEAD_SCOPE);
  const visible = await getVisibleAgentIds(principal, LEAD_SCOPE);
  if (visible === "all") return { kind: "all" };
  // Unassigned leads are the manager's queue, so team scope sees them and own scope does not.
  return { kind: "owners", ownerIds: visible, includeUnassigned: scope === "team" };
}

/** Whether `userId` is someone this person may hand work to. */
export function inScope(scope: LeadScope, userId: string): boolean {
  return scope.kind === "all" || scope.ownerIds.includes(userId);
}
