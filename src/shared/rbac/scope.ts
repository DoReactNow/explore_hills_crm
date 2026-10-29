// Data scope (own / team / all) for a principal, applied by services after the guard passes.
// The Super Admin bypass resolves to "all" here and nowhere else.
import type { PermissionCode } from "./permissionRegistry";
import type { Principal } from "./principal";

export type DataScope = "all" | "team" | "own" | "none";

export interface ScopePermissions {
  own: PermissionCode;
  team?: PermissionCode;
  all?: PermissionCode;
}

export function resolveScope(principal: Principal | null, scopes: ScopePermissions): DataScope {
  if (!principal) return "none";
  if (principal.bypassesAccess) return "all";
  if (scopes.all && principal.permissions.has(scopes.all)) return "all";
  if (scopes.team && principal.permissions.has(scopes.team)) return "team";
  if (principal.permissions.has(scopes.own)) return "own";
  return "none";
}
