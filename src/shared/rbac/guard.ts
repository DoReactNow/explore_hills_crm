// The guard in front of every action. Default deny; the Super Admin bypass is honoured here and in
// the scope resolver only (Decision 23). Feature code never checks role names.
import type { PermissionCode } from "./permissionRegistry";
import type { Principal } from "./principal";

export type Access =
  | "public"
  | "authenticated"
  | { permission: PermissionCode }
  | { anyOf: readonly PermissionCode[] };

export type AccessDecision = "allow" | "unauthenticated" | "forbidden";

export function can(principal: Principal | null, code: PermissionCode): boolean {
  if (!principal) return false;
  if (principal.bypassesAccess) return true;
  return principal.permissions.has(code);
}

/** The permission codes an access declaration asks for (empty for public/authenticated). */
export function requiredPermissions(access: Access | undefined): readonly PermissionCode[] | null {
  if (access && typeof access === "object") {
    if ("permission" in access && typeof access.permission === "string") return [access.permission];
    if ("anyOf" in access && Array.isArray(access.anyOf)) return access.anyOf;
  }
  return null;
}

export function checkAccess(
  access: Access | undefined,
  principal: Principal | null,
): AccessDecision {
  if (access === "public") return "allow";
  if (access === "authenticated") return principal ? "allow" : "unauthenticated";

  const codes = requiredPermissions(access);
  if (!codes || codes.length === 0) return "forbidden"; // missing or malformed access: deny
  if (!principal) return "unauthenticated";
  return codes.some((code) => can(principal, code)) ? "allow" : "forbidden";
}
