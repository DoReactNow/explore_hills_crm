// The Roles & Permissions rules (Decision 23), Super Admin only. A permission change applies on the
// holder's next request, because the principal is rebuilt every time. Two people editing one role
// cannot silently overwrite each other: each edit names the version it started from.
import { randomBytes } from "node:crypto";
import { recordAudit, type AuditAction, type AuditInput } from "@/modules/audit";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import { DEFAULT_ROLES } from "@/shared/rbac/defaultRoles";
import { PERMISSIONS, type PermissionCode } from "@/shared/rbac/permissionRegistry";
import { parseInstant, systemClock, type Clock } from "@/shared/time";
import { isUuid, type UserContext } from "./identity.context";
import type { Tx } from "./identity.repository";
import type { CreateRoleInput, UpdateRoleInput } from "./identity.schemas";

const ROLE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  isSystem: true,
  bypassesAccess: true,
  updatedAt: true,
  _count: { select: { users: true } },
  permissions: { select: { permission: { select: { id: true, code: true } } } },
} as const;

type RoleRow = NonNullable<Awaited<ReturnType<typeof loadRow>>>;

const loadRow = (tx: Tx, id: string) =>
  tx.identityRole.findUnique({ where: { id }, select: ROLE_SELECT });

const isDefaultRole = (code: string): code is keyof typeof DEFAULT_ROLES =>
  Object.hasOwn(DEFAULT_ROLES, code);

function grantableCodes(): PermissionCode[] {
  return (Object.keys(PERMISSIONS) as PermissionCode[]).filter(
    (code) => !PERMISSIONS[code].reserved,
  );
}

function toView(role: RoleRow) {
  const permissions = role.permissions
    .map((grant) => grant.permission.code)
    .filter((code): code is PermissionCode => Object.hasOwn(PERMISSIONS, code))
    .sort();
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    locked: role.bypassesAccess,
    userCount: role._count.users,
    permissions,
    /** What "Reset to defaults" would restore; null for a custom role. */
    defaultPermissions:
      role.isSystem && !role.bypassesAccess && isDefaultRole(role.code)
        ? [...DEFAULT_ROLES[role.code].permissions].sort()
        : null,
    version: role.updatedAt.toISOString(),
  };
}

export type RoleView = ReturnType<typeof toView>;

const refused = (message: string, field = "_root") =>
  new AppError("CONFLICT", { fieldErrors: [{ field, message }] });
const nameTaken = () => refused("A role with that name already exists.", "name");
const changedElsewhere = () => new AppError("CONFLICT");
const notFound = () => new AppError("NOT_FOUND");

function codeFromName(name: string): string {
  const code = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[A-Z]/.test(code) ? code : `ROLE_${randomBytes(4).toString("hex").toUpperCase()}`;
}

function assertGrantable(codes: readonly string[]): void {
  const allowed = new Set<string>(grantableCodes());
  if (codes.some((code) => !allowed.has(code))) {
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: [
        { field: "permissions", message: "One of those permissions can't be granted." },
      ],
    });
  }
}

async function writeGrants(tx: Tx, role: RoleRow, wanted: readonly string[]) {
  const current = new Map(
    role.permissions.map((grant) => [grant.permission.code, grant.permission.id]),
  );
  const added = wanted.filter((code) => !current.has(code)).sort();
  const removed = [...current.keys()].filter((code) => !wanted.includes(code)).sort();
  if (removed.length > 0) {
    await tx.identityRolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { in: removed.map((code) => current.get(code)!) } },
    });
  }
  if (added.length > 0) {
    const rows = await tx.identityPermission.findMany({
      where: { code: { in: added } },
      select: { id: true },
    });
    await tx.identityRolePermission.createMany({
      data: rows.map((row) => ({ roleId: role.id, permissionId: row.id })),
    });
  }
  return { added, removed };
}

function translatingNameConflict(error: unknown): never {
  if ((error as { code?: unknown }).code === "P2002") throw nameTaken();
  throw error;
}

export function createRoleService(clock: Clock = systemClock) {
  const prisma = () => getPrisma();

  const audit = (
    tx: Tx,
    { principal, requestId }: UserContext,
    action: AuditAction,
    entityId: string,
    summary: string,
    metadata?: AuditInput["metadata"],
  ) =>
    recordAudit(tx, {
      action,
      entityType: "role",
      entityId,
      summary,
      actor: { userId: principal.userId, roleCode: principal.roleCode },
      requestId,
      metadata,
    });

  async function loadForChange(tx: Tx, id: string): Promise<RoleRow> {
    if (!isUuid(id)) throw notFound();
    const role = await loadRow(tx, id);
    if (!role) throw notFound();
    if (role.bypassesAccess) throw refused("The Super Admin role can't be changed.");
    return role;
  }

  /** Claims the version: a second edit from the same starting point changes nothing and is refused. */
  async function claimVersion(tx: Tx, id: string, version: string, now: Date) {
    const { count } = await tx.identityRole.updateMany({
      where: { id, updatedAt: parseInstant(version) },
      data: { updatedAt: now },
    });
    if (count !== 1) throw changedElsewhere();
  }

  return {
    async listRoles({ principal }: UserContext) {
      assertCan(principal, "roles:manage");
      const roles = await prisma().identityRole.findMany({
        select: ROLE_SELECT,
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      });
      return {
        roles: roles.map(toView),
        // Reserved permissions are never offered (P2-ROLES-06).
        permissions: grantableCodes().map((code) => ({
          code,
          label: PERMISSIONS[code].label,
          description: PERMISSIONS[code].description,
          module: PERMISSIONS[code].module,
        })),
      };
    },

    /** Who may be given which role: the Super Admin role only for someone who may hand it out. */
    async roleOptions({ principal }: UserContext) {
      const roles = await prisma().identityRole.findMany({
        select: { code: true, name: true, bypassesAccess: true },
        orderBy: { name: "asc" },
      });
      const maySuper = principal.bypassesAccess;
      return roles
        .filter((role) => maySuper || !role.bypassesAccess)
        .map(({ code, name }) => ({ code, name }));
    },

    async createRole(context: UserContext, input: CreateRoleInput): Promise<RoleView> {
      assertCan(context.principal, "roles:manage");
      try {
        return await prisma().$transaction(async (tx) => {
          let permissions: string[] = [];
          if (input.copyFromCode) {
            const source = await tx.identityRole.findUnique({
              where: { code: input.copyFromCode },
              select: {
                bypassesAccess: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            });
            if (!source || source.bypassesAccess) {
              throw new AppError("VALIDATION_FAILED", {
                fieldErrors: [{ field: "copyFromCode", message: "Please choose a role to copy." }],
              });
            }
            permissions = source.permissions
              .map((grant) => grant.permission.code)
              .filter((code) => grantableCodes().includes(code as PermissionCode));
          }
          const created = await tx.identityRole.create({
            data: {
              code: codeFromName(input.name),
              name: input.name,
              description: input.description ?? null,
              isSystem: false,
            },
            select: ROLE_SELECT,
          });
          await writeGrants(tx, created, permissions);
          await audit(tx, context, "role.created", created.id, "Role created", {
            permissions: permissions.length,
          });
          return toView((await loadRow(tx, created.id))!);
        });
      } catch (error) {
        return translatingNameConflict(error);
      }
    },

    async updateRole(context: UserContext, id: string, input: UpdateRoleInput): Promise<RoleView> {
      assertCan(context.principal, "roles:manage");
      if (input.permissions) assertGrantable(input.permissions);
      try {
        return await prisma().$transaction(async (tx) => {
          const role = await loadForChange(tx, id);
          if (input.name !== undefined && input.name !== role.name && role.isSystem) {
            throw refused("A built-in role can't be renamed.", "name");
          }
          await claimVersion(tx, id, input.version, clock.now());
          if (input.name !== undefined && input.name !== role.name) {
            await tx.identityRole.update({ where: { id }, data: { name: input.name } });
            await audit(tx, context, "role.updated", id, "Role renamed");
          }
          if (input.permissions) {
            const { added, removed } = await writeGrants(tx, role, input.permissions);
            if (added.length + removed.length > 0) {
              await audit(tx, context, "role.permissions_changed", id, "Role permissions changed", {
                added,
                removed,
              });
            }
          }
          return toView((await loadRow(tx, id))!);
        });
      } catch (error) {
        return translatingNameConflict(error);
      }
    },

    async deleteRole(context: UserContext, id: string): Promise<void> {
      assertCan(context.principal, "roles:manage");
      const inUse = () => refused("People still have this role. Give them another role first.");
      try {
        await prisma().$transaction(async (tx) => {
          const role = await loadForChange(tx, id);
          if (role.isSystem) throw refused("A built-in role can't be deleted.");
          if (role._count.users > 0) throw inUse();
          await tx.identityRole.delete({ where: { id } });
          await audit(tx, context, "role.deleted", id, "Role deleted");
        });
      } catch (error) {
        // Someone given this role at the same moment trips the foreign key instead (P2-ROLES-04).
        if ((error as { code?: unknown }).code === "P2003") throw inUse();
        throw error;
      }
    },

    /** Re-applies a built-in role's bundle from code. Custom roles have no defaults (P2-ROLES-10). */
    async resetRole(context: UserContext, id: string, version: string): Promise<RoleView> {
      assertCan(context.principal, "roles:manage");
      return prisma().$transaction(async (tx) => {
        const role = await loadForChange(tx, id);
        if (!role.isSystem || !isDefaultRole(role.code)) {
          throw refused("Only a built-in role has defaults to go back to.");
        }
        await claimVersion(tx, id, version, clock.now());
        const { added, removed } = await writeGrants(
          tx,
          role,
          DEFAULT_ROLES[role.code].permissions,
        );
        await audit(tx, context, "role.permissions_changed", id, "Role reset to defaults", {
          added,
          removed,
          reset: true,
        });
        return toView((await loadRow(tx, id))!);
      });
    },
  };
}

export const roleService = createRoleService();
