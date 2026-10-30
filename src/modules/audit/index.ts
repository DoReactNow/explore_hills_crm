// Public API of the audit module: the only entry point for other modules.
import { auditService } from "./audit.service";

export { AUDIT_ACTIONS, type AuditAction } from "./audit.types";
export type { AuditTx } from "./audit.repository";
export type { AuditInput } from "./audit.service";

export const recordAudit = auditService.recordAudit;
