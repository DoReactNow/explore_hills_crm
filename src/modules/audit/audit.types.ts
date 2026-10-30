// Types and constants of the audit module that UI code may import (no Prisma here).

export const AUDIT_ACTIONS = [
  "auth.signed_in",
  "auth.signed_out",
  "auth.sign_in_failed",
  "auth.locked",
  "user.created",
  "user.updated",
  "user.role_changed",
  "user.deactivated",
  "user.reactivated",
  "user.password_changed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
