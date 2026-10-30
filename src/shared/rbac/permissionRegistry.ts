// Every permission code lives here and nowhere else (Decision 4). A feature adds its codes here
// first, then guards its routes with them. `db:sync-rbac` writes this list to the database.

export interface PermissionDefinition {
  /** Human-readable name, shown on the Roles & Permissions page. */
  label: string;
  description: string;
  /** Owning module, for grouping on the Roles & Permissions page. */
  module: string;
  /** Reserved codes are never granted to any role; only the Super Admin bypass reaches them. */
  reserved: boolean;
}

export const PERMISSIONS = {
  "system:view-diagnostics": {
    label: "View diagnostics",
    description: "See the diagnostics page: database, worker and job health.",
    module: "system",
    reserved: false,
  },
  "users:view": {
    label: "View users",
    description: "See the list of users and their details.",
    module: "identity",
    reserved: false,
  },
  "users:create": {
    label: "Create users",
    description: "Add a user and give them a default password.",
    module: "identity",
    reserved: false,
  },
  "users:edit": {
    label: "Edit users",
    description: "Change a user's details and role, and set a new password for them.",
    module: "identity",
    reserved: false,
  },
  "users:deactivate": {
    label: "Deactivate users",
    description: "Deactivate and reactivate users. Deactivating signs them out everywhere.",
    module: "identity",
    reserved: false,
  },
  "roles:manage": {
    label: "Manage roles and permissions",
    description: "Create, edit and delete roles and choose what each role may do.",
    module: "identity",
    reserved: true,
  },
  "users:manage-super-admins": {
    label: "Manage Super Admins",
    description:
      "Create, edit or deactivate Super Admin accounts, and give a user the Super Admin role.",
    module: "identity",
    reserved: true,
  },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export const RESERVED_PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_CODES.filter(
  (code) => PERMISSIONS[code].reserved,
);
