// Audit rules. An event is written inside the caller's transaction, so it commits or rolls back
// with the change it describes, and a failed write fails that change.
import { systemClock, type Clock } from "@/shared/time";
import { auditRepository, type AuditRepository, type AuditTx } from "./audit.repository";
import { AUDIT_ACTIONS, type AuditAction } from "./audit.types";

export type AuditMetadataValue =
  string | number | boolean | null | AuditMetadataValue[] | { [key: string]: AuditMetadataValue };

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  /** Who did it; null for a system action (a job or webhook). */
  actor: { userId: string; roleCode: string } | null;
  /** IDs and flags only: values that look like an email or phone number are refused, here and in the summary. */
  metadata?: Record<string, AuditMetadataValue>;
  requestId?: string;
}

const EMAIL = /[^@\s]+@[^@\s]+\.[^@\s]+/;
// Digit runs with phone separators, not part of a longer token such as a UUID or a timestamp.
const PHONE_CANDIDATE = /(?<![\w:.-])\+?\d[\d\s()-]{8,}\d(?![\w:.-])/g;
const MIN_PHONE_DIGITS = 10;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function looksPersonal(value: string): boolean {
  if (EMAIL.test(value)) return true;
  return (value.replace(UUID, "").match(PHONE_CANDIDATE) ?? []).some(
    (candidate) => candidate.replace(/\D/g, "").length >= MIN_PHONE_DIGITS,
  );
}

function holdsPersonalData(value: AuditMetadataValue): boolean {
  if (typeof value === "string") return looksPersonal(value);
  if (typeof value === "number") return looksPersonal(String(value));
  if (Array.isArray(value)) return value.some(holdsPersonalData);
  if (value && typeof value === "object") return Object.values(value).some(holdsPersonalData);
  return false;
}

// These errors mean the calling code is wrong, so they are plain errors: the transaction fails and
// the user sees INTERNAL_ERROR. They name the key only, never the value.
function assertValid(input: AuditInput): void {
  if (!AUDIT_ACTIONS.includes(input.action)) {
    throw new Error("Audit event has an unregistered action");
  }
  for (const field of ["entityType", "entityId", "summary"] as const) {
    if (!input[field].trim()) throw new Error(`Audit event is missing ${field}`);
  }
  // The trail is kept for good, and an erasure can't reach it, so no personal data may go in (Decision 66).
  if (looksPersonal(input.summary)) {
    throw new Error("Audit summary looks like it holds an email or phone number");
  }
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (holdsPersonalData(value)) {
      throw new Error(`Audit metadata "${key}" looks like an email or phone number`);
    }
  }
}

export function createAuditService(
  repository: Pick<AuditRepository, "insert"> = auditRepository,
  clock: Clock = systemClock,
) {
  return {
    async recordAudit(tx: AuditTx, input: AuditInput): Promise<void> {
      assertValid(input);
      await repository.insert(tx, {
        occurredAt: clock.now(),
        actorUserId: input.actor?.userId ?? null,
        actorRoleCode: input.actor?.roleCode ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        metadata: input.metadata ?? {},
        requestId: input.requestId ?? null,
      });
    },
  };
}

export const auditService = createAuditService();
