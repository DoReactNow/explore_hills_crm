// What a customer's message does to their lead (Decision 57): the open lead if there is one, or a new
// linked lead. Runs inside the caller's transaction, under a lock on the phone number, so two
// messages arriving together make one lead.
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/modules/audit";
import { leadRepository, type Tx } from "./leads.repository";

export async function resolveLeadForInbound(
  tx: Tx,
  input: { phoneE164: string; profileName: string | null; occurredAt: Date },
) {
  const repository = leadRepository;
  await repository.lockPhone(tx, input.phoneE164);
  let contact = await repository.findContactByPhone(tx, input.phoneE164);
  if (!contact) {
    contact = await repository.createContact(tx, {
      phoneE164: input.phoneE164,
      name: input.profileName,
    });
  } else {
    if (contact.deletedAt) await repository.restoreContact(tx, contact.id);
    // A profile name fills a gap and never replaces a name staff may have typed.
    if (!contact.name && input.profileName) {
      await repository.updateContactName(tx, contact.id, input.profileName);
    }
  }

  const open = await repository.findOpenLeadOfContact(tx, contact.id);
  if (open) return { contact, leadId: open.id, created: false };

  const stage = await repository.findStage(tx, "NEW");
  if (!stage) throw new Error("The pipeline stages have not been seeded");
  const lead = await repository.createLead(tx, {
    contactId: contact.id,
    stageId: stage.id,
    source: "WHATSAPP",
    lastActivityAt: input.occurredAt,
  });
  await repository.addTimeline(tx, {
    leadId: lead.id,
    kind: "LEAD_CREATED",
    summary: "Lead created from a WhatsApp message",
    refType: "lead",
    refId: lead.id,
    occurredAt: input.occurredAt,
  });
  await recordAudit(tx, {
    action: "lead.created",
    entityType: "lead",
    entityId: lead.id,
    summary: "Lead created from a WhatsApp message",
    actor: null,
    metadata: { source: "WHATSAPP" },
  });
  return { contact, leadId: lead.id, created: true };
}

export async function setContactOpt(
  tx: Tx,
  input: {
    contactId: string;
    status: "OPTED_IN" | "OPTED_OUT";
    source: string;
    at: Date;
    actor: { userId: string; roleCode: string } | null;
    requestId?: string;
  },
): Promise<void> {
  await leadRepository.setContactOpt(tx, input.contactId, {
    optInStatus: input.status,
    optInAt: input.at,
    optInSource: input.source,
  });
  await recordAudit(tx, {
    action: "contact.opt_changed",
    entityType: "contact",
    entityId: input.contactId,
    summary: input.status === "OPTED_IN" ? "Customer opted in" : "Customer opted out",
    actor: input.actor,
    requestId: input.requestId,
    metadata: { status: input.status, source: input.source },
  });
}

/** The first reply on a lead records the time, and moves a New lead to Contacted (the design's rule). */
export async function recordFirstResponse(
  tx: Tx,
  input: { leadId: string; at: Date; actor: { userId: string; roleCode: string } },
): Promise<void> {
  const repository = leadRepository;
  if (!(await repository.markFirstResponse(tx, input.leadId, input.at))) return;
  const lead = await tx.leadsLead.findUnique({
    where: { id: input.leadId },
    select: { stage: { select: { code: true, name: true } } },
  });
  const contacted = await repository.findStage(tx, "CONTACTED");
  if (lead?.stage.code !== "NEW" || !contacted?.isActive) return;
  await tx.leadsLead.update({ where: { id: input.leadId }, data: { stageId: contacted.id } });
  await repository.addTimeline(tx, {
    leadId: input.leadId,
    kind: "STAGE_CHANGED",
    summary: `Stage changed: ${lead.stage.name} → ${contacted.name}`,
    refType: "stage_change",
    refId: randomUUID(),
    actorUserId: input.actor.userId,
    occurredAt: input.at,
  });
  await recordAudit(tx, {
    action: "lead.stage_changed",
    entityType: "lead",
    entityId: input.leadId,
    summary: "Lead stage changed by the first reply",
    actor: input.actor,
    metadata: { from: "NEW", to: "CONTACTED" },
  });
}
