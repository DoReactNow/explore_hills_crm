// Prisma access to audit_events. Insert only: the trail is append-only (a database trigger refuses
// UPDATE and DELETE), so this repository offers nothing else that writes.
import type { Prisma } from "@/generated/prisma/client";

export type AuditTx = Prisma.TransactionClient;

export interface NewAuditEvent {
  occurredAt: Date;
  actorUserId: string | null;
  actorRoleCode: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Prisma.InputJsonObject;
  requestId: string | null;
}

export const auditRepository = {
  async insert(tx: AuditTx, event: NewAuditEvent): Promise<void> {
    await tx.auditEvent.create({ data: event });
  },
};

export type AuditRepository = typeof auditRepository;
