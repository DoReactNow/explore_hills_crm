// Prisma access to the identity module's RBAC tables (identity_permissions, identity_roles,
// identity_role_permissions). No business rules here.
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";

export type Tx = Prisma.TransactionClient;

export interface PermissionRow {
  id: string;
  code: string;
  label: string;
  description: string;
  module: string;
  isReserved: boolean;
}

export interface NewPermission {
  code: string;
  label: string;
  description: string;
  module: string;
  isReserved: boolean;
}

export interface NewRole {
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  bypassesAccess: boolean;
}

export const identityRepository = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work);
  },

  listPermissions(tx: Tx): Promise<PermissionRow[]> {
    return tx.identityPermission.findMany({
      select: {
        id: true,
        code: true,
        label: true,
        description: true,
        module: true,
        isReserved: true,
      },
      orderBy: { code: "asc" },
    });
  },

  async createPermissions(tx: Tx, permissions: NewPermission[]): Promise<void> {
    if (permissions.length > 0) await tx.identityPermission.createMany({ data: permissions });
  },

  async updatePermission(tx: Tx, code: string, data: Omit<NewPermission, "code">): Promise<void> {
    await tx.identityPermission.update({ where: { code }, data });
  },

  /** Deletes permissions; their grants go with them (ON DELETE CASCADE inside the module). */
  async deletePermissions(tx: Tx, codes: string[]): Promise<void> {
    if (codes.length > 0)
      await tx.identityPermission.deleteMany({ where: { code: { in: codes } } });
  },

  listRoles(tx: Tx): Promise<Array<{ id: string; code: string; bypassesAccess: boolean }>> {
    return tx.identityRole.findMany({ select: { id: true, code: true, bypassesAccess: true } });
  },

  createRole(tx: Tx, role: NewRole): Promise<{ id: string }> {
    return tx.identityRole.create({ data: role, select: { id: true } });
  },

  async addGrants(tx: Tx, roleId: string, permissionIds: string[]): Promise<void> {
    if (permissionIds.length === 0) return;
    await tx.identityRolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    });
  },

  findRoleAccess(code: string) {
    return getPrisma().identityRole.findUnique({
      where: { code },
      select: {
        code: true,
        bypassesAccess: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
  },
};

export type IdentityRepository = typeof identityRepository;
