// Whose records a person may see, for any module's service (project_data.md Section 3.4). Resolved
// once per request and passed to repositories as a filter. "team" means the whole branch below the
// person (Decision 55).
import type { Principal } from "@/shared/rbac/principal";
import { resolveScope, type ScopePermissions } from "@/shared/rbac/scope";
import { userRepository } from "./identity.users.repository";

export async function getVisibleAgentIds(
  principal: Principal,
  scopes: ScopePermissions,
): Promise<string[] | "all"> {
  const scope = resolveScope(principal, scopes);
  if (scope === "all") return "all";
  if (scope === "team") return userRepository.visibleUserIds(principal.userId);
  return scope === "own" ? [principal.userId] : [];
}

/** Just enough of a person for another module to check they can be given work. */
export async function getUserSummary(
  id: string,
): Promise<{ id: string; name: string; status: string } | null> {
  const user = await userRepository.getUser(id);
  return user && { id: user.id, name: user.name, status: user.status };
}
