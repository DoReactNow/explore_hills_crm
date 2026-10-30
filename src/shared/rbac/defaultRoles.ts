// Default bundles of the system roles (project_data.md Section 5.4). `db:sync-rbac` applies a
// bundle when a role is created and grants each NEW permission to the roles listed here; it never
// overwrites grants edited on the Roles & Permissions page (Decision 23).
import type { PermissionCode } from "./permissionRegistry";

export interface RoleDefinition<C extends string = string> {
  name: string;
  description: string;
  /** Only SUPER_ADMIN: passes every access check. Read only by the guard and scope resolver. */
  bypassesAccess: boolean;
  permissions: readonly C[];
}

export const SYSTEM_ROLE_CODES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "AGENT"] as const;
export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

export const DEFAULT_ROLES = {
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Can do everything, including managing roles, permissions and Super Admins.",
    bypassesAccess: true,
    permissions: [],
  },
  ADMIN: {
    name: "Admin",
    description: "Runs the platform day to day: users, settings, templates and reports.",
    bypassesAccess: false,
    permissions: [
      "system:view-diagnostics",
      "users:view",
      "users:create",
      "users:edit",
      "users:deactivate",
    ],
  },
  MANAGER: {
    name: "Manager",
    description: "Distributes leads, watches the team and views reports.",
    bypassesAccess: false,
    permissions: ["users:view"],
  },
  AGENT: {
    name: "Agent",
    description: "Works their own leads: chat, calls, notes and claiming from a pool.",
    bypassesAccess: false,
    permissions: [],
  },
} as const satisfies Record<SystemRoleCode, RoleDefinition<PermissionCode>>;
