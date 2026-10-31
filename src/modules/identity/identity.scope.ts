// Whose records a person may see, for any module's service (project_data.md Section 3.4). Resolved
// once per request and passed to repositories as a filter. "team" means the whole branch below the
// person (Decision 55).
import type { Principal } from "@/shared/rbac/principal";
import { resolveScope, type ScopePermissions } from "@/shared/rbac/scope";
import type { Tx } from "./identity.repository";
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
export async function getUserSummary(id: string): Promise<{
  id: string;
  name: string;
  status: string;
  managerId: string | null;
  phoneE164: string | null;
  roleCode: string;
} | null> {
  const user = await userRepository.getUser(id);
  return (
    user && {
      id: user.id,
      name: user.name,
      status: user.status,
      managerId: user.manager?.id ?? null,
      phoneE164: user.phoneE164,
      roleCode: user.role.code,
    }
  );
}

/** Active people who can be given leads, among those listed. */
export const listAssignableUsers = (ids: readonly string[] | "all", tx?: Tx) =>
  userRepository.listActiveHolders("leads:claim", ids, tx);

/** Active people who can take calls. */
export const listCallers = (tx?: Tx) =>
  userRepository.listActiveHolders("telephony:call", "all", tx);

/** Active managers above a person, at every level. */
export const listManagersAbove = (userId: string) => userRepository.managersAbove(userId);

/** Active people holding a permission, such as those who can see every lead. */
export const listHolders = (code: string) => userRepository.listActiveHolders(code, "all");

/** Email address and status, only for sending a notification. */
export const getNotifiableUser = (id: string) => userRepository.getUser(id);
