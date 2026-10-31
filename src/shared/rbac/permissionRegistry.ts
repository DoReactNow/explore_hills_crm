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
  "users:view-all": {
    label: "View all users",
    description: "See every user. Without this, a person with View users sees only their branch.",
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
  "teams:view": {
    label: "View teams",
    description: "See the teams in their own branch, and who belongs to them.",
    module: "identity",
    reserved: false,
  },
  "teams:view-all": {
    label: "View all teams",
    description: "See every team, not only those in their own branch.",
    module: "identity",
    reserved: false,
  },
  "teams:manage": {
    label: "Manage teams",
    description: "Create, rename and delete teams, and change their manager and members.",
    module: "identity",
    reserved: false,
  },
  "leads:create": {
    label: "Create leads",
    description: "Add a lead by hand.",
    module: "leads",
    reserved: false,
  },
  "leads:view-own": {
    label: "View own leads",
    description: "See the leads they own.",
    module: "leads",
    reserved: false,
  },
  "leads:view-team": {
    label: "View team leads",
    description: "See leads owned by anyone in their branch, and unassigned leads.",
    module: "leads",
    reserved: false,
  },
  "leads:view-all": {
    label: "View all leads",
    description: "See every lead in the company.",
    module: "leads",
    reserved: false,
  },
  "leads:edit": {
    label: "Edit leads",
    description:
      "Change trip details and stage, and add notes and follow-ups, on leads they can see.",
    module: "leads",
    reserved: false,
  },
  "leads:delete": {
    label: "Delete leads",
    description: "Remove a lead from every list. Its history is kept.",
    module: "leads",
    reserved: false,
  },
  "leads:assign": {
    label: "Assign leads",
    description: "Choose who owns a new lead, and share out leads from the queue.",
    module: "leads",
    reserved: false,
  },
  "leads:reassign": {
    label: "Reassign leads",
    description: "Move a lead from one agent to another.",
    module: "leads",
    reserved: false,
  },
  "leads:claim": {
    label: "Take leads",
    description: "Be given leads, and accept leads from a blast pool.",
    module: "leads",
    reserved: false,
  },
  "notifications:mute": {
    label: "Turn notifications off",
    description: "Choose which notifications they get. Others keep theirs, so no lead is missed.",
    module: "notifications",
    reserved: false,
  },
  "telephony:call": {
    label: "Make and take calls",
    description: "Place and receive calls on leads they can see.",
    module: "telephony",
    reserved: false,
  },
  "telephony:view-recordings": {
    label: "Listen to recordings",
    description: "Play call recordings on leads they can see. Every playback is audited.",
    module: "telephony",
    reserved: false,
  },
  "assignment:manage-rules": {
    label: "Manage assignment rules",
    description: "Set agents' caps, tiers, shifts and leave, and the auto-assign rule.",
    module: "assignment",
    reserved: false,
  },
  "settings:manage": {
    label: "Manage settings",
    description: "Change system settings and the pipeline stages.",
    module: "system",
    reserved: false,
  },
  "leads:merge": {
    label: "Merge leads",
    description: "Combine two leads into one, keeping all their history.",
    module: "leads",
    reserved: false,
  },
  "messaging:view": {
    label: "View conversations",
    description: "Read WhatsApp conversations on leads they can see.",
    module: "messaging",
    reserved: false,
  },
  "messaging:send": {
    label: "Send WhatsApp messages",
    description: "Reply to customers and send approved templates.",
    module: "messaging",
    reserved: false,
  },
  "messaging:manage-templates": {
    label: "Manage templates",
    description: "Create, change and delete WhatsApp message templates.",
    module: "messaging",
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
