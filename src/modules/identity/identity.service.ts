// Identity rules. Phase 0: building a principal from a role's grants in the database.
// Phase 1 adds users and sessions and resolves the principal from the signed-in user.
import { PERMISSIONS, type PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import { identityRepository, type IdentityRepository } from "./identity.repository";

const isRegistered = (code: string): code is PermissionCode => Object.hasOwn(PERMISSIONS, code);

/** The identity card for a user holding a role. Unregistered grants are ignored (see below). */
export function principalFromRole(
  userId: string,
  role: {
    code: string;
    bypassesAccess: boolean;
    permissions: Array<{ permission: { code: string } }>;
  },
): Principal {
  return {
    userId,
    roleCode: role.code,
    bypassesAccess: role.bypassesAccess,
    // Grants for codes no longer in the registry are ignored until the next sync removes them.
    permissions: new Set(
      role.permissions.map((grant) => grant.permission.code).filter(isRegistered),
    ),
  };
}

export function createIdentityService(repository: IdentityRepository = identityRepository) {
  return {
    /** The identity card for `userId` holding `roleCode`, from the role's current grants. */
    async buildPrincipalForRole(roleCode: string, userId: string): Promise<Principal> {
      const role = await repository.findRoleAccess(roleCode);
      if (!role) throw new Error(`Role "${roleCode}" does not exist; run db:sync-rbac`);
      return principalFromRole(userId, role);
    },
  };
}

export const identityService = createIdentityService();
