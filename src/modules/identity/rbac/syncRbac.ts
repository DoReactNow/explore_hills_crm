// db:sync-rbac (Decisions 4 and 23). Idempotent, holds no secrets, runs in every environment.
//   1. inserts permissions new to the registry and grants each NEW one to the roles listed for it;
//   2. updates labels and descriptions of existing permissions;
//   3. deletes permissions removed from the registry, with their grants;
//   4. creates missing system roles with their default bundle (SUPER_ADMIN with the bypass, no grants);
//   5. never changes the grants of existing roles otherwise, and never updates SUPER_ADMIN.
import { DEFAULT_ROLES, type RoleDefinition } from "@/shared/rbac/defaultRoles";
import { PERMISSIONS, type PermissionDefinition } from "@/shared/rbac/permissionRegistry";
import { identityRepository, type IdentityRepository } from "../identity.repository";

export interface SyncRbacOptions {
  permissions?: Readonly<Record<string, PermissionDefinition>>;
  roles?: Readonly<Record<string, RoleDefinition>>;
  repository?: IdentityRepository;
}

export interface SyncRbacSummary {
  permissionsAdded: string[];
  permissionsRemoved: string[];
  permissionsUpdated: string[];
  rolesCreated: string[];
  grantsAdded: number;
}

function validate(
  permissions: Readonly<Record<string, PermissionDefinition>>,
  roles: Readonly<Record<string, RoleDefinition>>,
): void {
  const bypassRoles = Object.entries(roles).filter(([, role]) => role.bypassesAccess);
  if (bypassRoles.length > 1) throw new Error("syncRbac: only one role may bypass access checks");
  for (const [code, role] of Object.entries(roles)) {
    if (role.bypassesAccess && role.permissions.length > 0) {
      throw new Error(`syncRbac: the bypass role ${code} cannot hold grants`);
    }
    for (const permission of role.permissions) {
      const definition = permissions[permission];
      if (!definition) throw new Error(`syncRbac: ${code} lists unknown permission ${permission}`);
      if (definition.reserved)
        throw new Error(`syncRbac: ${code} lists reserved permission ${permission}`);
    }
  }
}

export async function syncRbac(options: SyncRbacOptions = {}): Promise<SyncRbacSummary> {
  const permissions: Readonly<Record<string, PermissionDefinition>> =
    options.permissions ?? PERMISSIONS;
  const roles: Readonly<Record<string, RoleDefinition>> = options.roles ?? DEFAULT_ROLES;
  const repository = options.repository ?? identityRepository;
  validate(permissions, roles);

  return repository.transaction(async (tx) => {
    const existing = new Map((await repository.listPermissions(tx)).map((row) => [row.code, row]));
    const desired = Object.entries(permissions);

    const added = desired.filter(([code]) => !existing.has(code)).map(([code]) => code);
    const removed = [...existing.keys()].filter((code) => !Object.hasOwn(permissions, code));
    const updated: string[] = [];

    await repository.createPermissions(
      tx,
      added.map((code) => ({
        code,
        label: permissions[code].label,
        description: permissions[code].description,
        module: permissions[code].module,
        isReserved: permissions[code].reserved,
      })),
    );
    for (const [code, definition] of desired) {
      const row = existing.get(code);
      if (!row) continue;
      const next = {
        label: definition.label,
        description: definition.description,
        module: definition.module,
        isReserved: definition.reserved,
      };
      if (
        row.label !== next.label ||
        row.description !== next.description ||
        row.module !== next.module ||
        row.isReserved !== next.isReserved
      ) {
        await repository.updatePermission(tx, code, next);
        updated.push(code);
      }
    }
    await repository.deletePermissions(tx, removed);

    const permissionIds = new Map(
      (await repository.listPermissions(tx)).map((row) => [row.code, row.id]),
    );
    const existingRoles = new Map((await repository.listRoles(tx)).map((row) => [row.code, row]));
    const addedSet = new Set(added);
    const rolesCreated: string[] = [];
    let grantsAdded = 0;

    for (const [code, role] of Object.entries(roles)) {
      const current = existingRoles.get(code);
      if (!current) {
        const created = await repository.createRole(tx, {
          code,
          name: role.name,
          description: role.description,
          isSystem: true,
          bypassesAccess: role.bypassesAccess,
        });
        const ids = role.permissions.map((permission) => permissionIds.get(permission)!);
        await repository.addGrants(tx, created.id, ids);
        rolesCreated.push(code);
        grantsAdded += ids.length;
      } else if (!current.bypassesAccess) {
        const ids = role.permissions
          .filter((permission) => addedSet.has(permission))
          .map((permission) => permissionIds.get(permission)!);
        await repository.addGrants(tx, current.id, ids);
        grantsAdded += ids.length;
      }
    }

    return {
      permissionsAdded: added,
      permissionsRemoved: removed,
      permissionsUpdated: updated,
      rolesCreated,
      grantsAdded,
    };
  });
}
