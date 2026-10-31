// Lead rules (Decision 57): one open lead per contact, stage changes with their history, scoped
// reads and writes. A lead out of scope is "not found", so nobody learns it exists.
import { randomUUID } from "node:crypto";
import { recordAudit, type AuditAction, type AuditInput } from "@/modules/audit";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import { can } from "@/shared/rbac/guard";
import type { Principal } from "@/shared/rbac/principal";
import {
  businessDateToDbDate,
  parseInstant,
  systemClock,
  todayBusinessDate,
  type Clock,
} from "@/shared/time";
import { getUserSummary } from "@/modules/identity";
import { inScope, leadScopeOf } from "./leads.access";
import { normalisePhone } from "./leads.phone";
import { assertNotErased } from "./leads.privacy";
import {
  leadRepository,
  type LeadRepository,
  type LeadRow,
  type LeadScope,
  type NewTimelineEntry,
  type Tx,
} from "./leads.repository";
import type {
  AddNoteInput,
  CreateLeadInput,
  ListLeadsInput,
  MoveStageInput,
  UpdateLeadInput,
} from "./leads.schemas";
import { toLeadView, toTaskView, type LeadView } from "./leads.views";

export interface LeadContext {
  principal: Principal;
  requestId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

const notFound = () => new AppError("NOT_FOUND");
const invalid = (field: string, message: string) =>
  new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message }] });
const changedElsewhere = () => new AppError("CONFLICT");

interface LeadServiceDeps {
  repository?: LeadRepository;
  clock?: Clock;
}

export function createLeadService({
  repository = leadRepository,
  clock = systemClock,
}: LeadServiceDeps = {}) {
  const audit = (
    tx: Tx,
    { principal, requestId }: LeadContext,
    action: AuditAction,
    entityId: string,
    summary: string,
    metadata?: AuditInput["metadata"],
  ) =>
    recordAudit(tx, {
      action,
      entityType: "lead",
      entityId,
      summary,
      actor: { userId: principal.userId, roleCode: principal.roleCode },
      requestId,
      metadata,
    });

  /** Refuses a second open lead, linking the existing one only if this person may see it. */
  async function assertNoOtherOpenLead(
    tx: Tx,
    contactId: string,
    scope: LeadScope,
    exceptLeadId?: string,
  ) {
    const existing = await repository.findOpenLeadOfContact(tx, contactId, exceptLeadId);
    if (!existing) return;
    const visible =
      scope.kind === "all" ||
      (existing.ownerUserId
        ? scope.ownerIds.includes(existing.ownerUserId)
        : scope.includeUnassigned);
    throw new AppError("CONFLICT", {
      fieldErrors: [
        {
          field: "phone",
          message: visible
            ? `This customer already has an open lead: /leads/${existing.id}`
            : "This customer already has an open lead with a colleague. Please ask your manager.",
        },
      ],
    });
  }

  async function resolveOwner(
    principal: Principal,
    scope: LeadScope,
    requested: string | null | undefined,
  ): Promise<string | null> {
    if (!can(principal, "leads:assign")) {
      if (requested && requested !== principal.userId) {
        throw new AppError("FORBIDDEN", {
          logContext: { permission: "leads:assign", principalId: principal.userId },
        });
      }
      return principal.userId;
    }
    if (!requested) return null;
    const refuse = () => invalid("ownerUserId", "Please choose an active person you manage.");
    if (!isUuid(requested) || !inScope(scope, requested)) throw refuse();
    const owner = await getUserSummary(requested);
    if (owner?.status !== "ACTIVE") throw refuse();
    return requested;
  }

  const timeline = (tx: Tx | null, entry: NewTimelineEntry) => repository.addTimeline(tx, entry);

  /** The lead, for a change. */
  async function loadChangeable(tx: Tx, id: string, scope: LeadScope): Promise<LeadRow> {
    const lead = await loadLead(tx, id, scope);
    assertNotErased(lead.contact);
    return lead;
  }

  /** Inside a transaction: the lead, if this person may see it. */
  async function loadLead(tx: Tx, id: string, scope: LeadScope): Promise<LeadRow> {
    if (!isUuid(id)) throw notFound();
    const lead = await repository.findLead(tx, id, scope);
    if (!lead) throw notFound();
    return lead;
  }

  return {
    async createLead(context: LeadContext, input: CreateLeadInput): Promise<LeadView> {
      const { principal } = context;
      assertCan(principal, "leads:create");
      const scope = await leadScopeOf(principal);
      const ownerUserId = await resolveOwner(principal, scope, input.ownerUserId);
      const now = clock.now();

      return repository.transaction(async (tx) => {
        await repository.lockPhone(tx, input.phone);
        let contact = await repository.findContactByPhone(tx, input.phone);
        if (!contact) {
          contact = await repository.createContact(tx, {
            phoneE164: input.phone,
            name: input.customerName,
          });
        } else {
          await assertNoOtherOpenLead(tx, contact.id, scope);
          if (contact.deletedAt) await repository.restoreContact(tx, contact.id);
          if (!contact.name) await repository.updateContactName(tx, contact.id, input.customerName);
        }

        const stage = await repository.findStage(tx, "NEW");
        if (!stage) throw new Error("The pipeline stages have not been seeded");

        const lead = await repository.createLead(tx, {
          contactId: contact.id,
          stageId: stage.id,
          source: input.source,
          ownerUserId,
          assignedAt: ownerUserId ? now : null,
          destination: input.destination ?? null,
          travelStartDate: input.travelStartDate
            ? businessDateToDbDate(input.travelStartDate)
            : null,
          travelEndDate: input.travelEndDate ? businessDateToDbDate(input.travelEndDate) : null,
          travellerCount: input.travellerCount ?? null,
          budgetAmount: input.budgetAmount ?? null,
          customFields: input.customFields ?? {},
          lastActivityAt: now,
        });
        await timeline(tx, {
          leadId: lead.id,
          kind: "LEAD_CREATED",
          summary: "Lead created",
          refType: "lead",
          refId: lead.id,
          actorUserId: principal.userId,
          occurredAt: now,
        });
        if (input.note) {
          const note = await repository.createNote(tx, {
            leadId: lead.id,
            authorUserId: principal.userId,
            body: input.note,
            createdAt: now,
          });
          await timeline(tx, {
            leadId: lead.id,
            kind: "NOTE",
            summary: "Note added",
            refType: "note",
            refId: note.id,
            actorUserId: principal.userId,
            occurredAt: now,
          });
        }
        await audit(tx, context, "lead.created", lead.id, "Lead created", { source: input.source });
        return toLeadView(lead);
      });
    },

    async listLeads(
      { principal }: LeadContext,
      input: ListLeadsInput & { openOnly?: boolean; createdBefore?: Date },
    ) {
      const { page, pageSize, search, owner, travelFrom, travelTo, ...filters } = input;
      const scope = await leadScopeOf(principal);
      const digits = search ? (normalisePhone(search) ?? search.replace(/\D/g, "")) : "";
      const { items, total, openCount, quickCounts } = await repository.listLeads({
        ...filters,
        scope,
        search,
        phoneDigits: digits.length >= 4 ? digits : undefined,
        ownerId: owner && owner !== "unassigned" ? owner : undefined,
        unassignedOnly: owner === "unassigned",
        travelFrom: travelFrom ? businessDateToDbDate(travelFrom) : undefined,
        travelTo: travelTo ? businessDateToDbDate(travelTo) : undefined,
        today: businessDateToDbDate(todayBusinessDate(clock)),
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: items.map(toLeadView), total, openCount, quickCounts, page, pageSize };
    },

    async getLead({ principal }: LeadContext, id: string) {
      const scope = await leadScopeOf(principal);
      const lead = await repository.transaction((tx) => loadLead(tx, id, scope));
      const [notes, tasks, entries, others] = await repository.leadDetailParts(
        lead.id,
        lead.contact.id,
        scope,
      );
      return {
        ...toLeadView(lead),
        notes,
        tasks: tasks.map(toTaskView),
        timeline: entries,
        otherLeads: others.map(toLeadView),
      };
    },

    async updateLead(context: LeadContext, id: string, input: UpdateLeadInput): Promise<LeadView> {
      assertCan(context.principal, "leads:edit");
      const scope = await leadScopeOf(context.principal);
      return repository.transaction(async (tx) => {
        const lead = await loadChangeable(tx, id, scope);
        const view = toLeadView(lead);
        const start =
          input.travelStartDate === undefined ? view.travelStartDate : input.travelStartDate;
        const end = input.travelEndDate === undefined ? view.travelEndDate : input.travelEndDate;
        if (start && end && end < start) {
          throw invalid("travelEndDate", "The trip can't end before it starts.");
        }

        const date = (value: string | null | undefined) =>
          value === undefined ? undefined : value ? businessDateToDbDate(value) : null;
        const written = await repository.updateLeadIfUnchanged(
          tx,
          id,
          parseInstant(input.version),
          {
            destination: input.destination,
            travelStartDate: date(input.travelStartDate),
            travelEndDate: date(input.travelEndDate),
            travellerCount: input.travellerCount,
            budgetAmount: input.budgetAmount,
            ...(input.customFields ? { customFields: input.customFields } : {}),
            lastActivityAt: clock.now(),
          },
        );
        if (!written) throw changedElsewhere();
        if (input.customerName && input.customerName !== lead.contact.name) {
          await repository.updateContactName(tx, lead.contact.id, input.customerName);
        }
        await audit(tx, context, "lead.updated", id, "Lead details updated");
        return toLeadView(await loadLead(tx, id, scope));
      });
    },

    async moveStage(context: LeadContext, id: string, input: MoveStageInput): Promise<LeadView> {
      const { principal } = context;
      assertCan(principal, "leads:edit");
      const scope = await leadScopeOf(principal);
      const now = clock.now();
      return repository.transaction(async (tx) => {
        const before = await loadLead(tx, id, scope);
        await repository.lockPhone(tx, before.contact.phoneE164);
        const lead = await loadChangeable(tx, id, scope);
        if (lead.stage.code === input.stageCode) return toLeadView(lead);

        const stage = await repository.findStage(tx, input.stageCode);
        if (!stage?.isActive)
          throw invalid("stageCode", "Please choose one of the current stages.");
        if (stage.kind === "LOST" && !input.lostReason) {
          throw invalid("lostReason", "Pick the main reason.");
        }
        const reopening = lead.stage.kind !== "OPEN" && stage.kind === "OPEN";
        if (reopening) await assertNoOtherOpenLead(tx, lead.contact.id, scope, lead.id);

        await repository.updateLead(tx, id, {
          stageId: stage.id,
          closedAt: stage.kind === "OPEN" ? null : now,
          lostReason: stage.kind === "LOST" ? input.lostReason : null,
          lastActivityAt: now,
        });
        await repository.refreshNextFollowUp(tx, id);
        await timeline(tx, {
          leadId: id,
          kind: "STAGE_CHANGED",
          summary: `Stage changed: ${lead.stage.name} → ${stage.name}`,
          refType: "stage_change",
          refId: randomUUID(),
          actorUserId: principal.userId,
          occurredAt: now,
        });
        await audit(tx, context, "lead.stage_changed", id, "Lead stage changed", {
          from: lead.stage.code,
          to: stage.code,
        });
        return toLeadView(await loadLead(tx, id, scope));
      });
    },

    /** Always a soft delete: the lead leaves every list, and its history stays. */
    async deleteLead(context: LeadContext, id: string): Promise<void> {
      assertCan(context.principal, "leads:delete");
      const scope = await leadScopeOf(context.principal);
      await repository.transaction(async (tx) => {
        await loadLead(tx, id, scope);
        await repository.updateLead(tx, id, { deletedAt: clock.now() });
        await audit(tx, context, "lead.deleted", id, "Lead deleted");
      });
    },

    async addNote({ principal }: LeadContext, id: string, input: AddNoteInput) {
      assertCan(principal, "leads:edit");
      const scope = await leadScopeOf(principal);
      const now = clock.now();
      return repository.transaction(async (tx) => {
        await loadChangeable(tx, id, scope);
        const note = await repository.createNote(tx, {
          leadId: id,
          authorUserId: principal.userId,
          body: input.body,
          createdAt: now,
        });
        await timeline(tx, {
          leadId: id,
          kind: "NOTE",
          summary: "Note added",
          refType: "note",
          refId: note.id,
          actorUserId: principal.userId,
          occurredAt: now,
        });
        await repository.touchActivity(tx, id, now);
        return note;
      });
    },

    /**
     * Combines two leads, keeping all history on the survivor (Decision 58). Other modules move what
     * they own through `alsoMove`, in the same transaction. Repeating it changes nothing more.
     */
    async mergeLeads(
      context: LeadContext,
      id: string,
      intoLeadId: string,
      alsoMove?: (tx: Tx, fromId: string, toId: string) => Promise<void>,
    ): Promise<LeadView> {
      assertCan(context.principal, "leads:merge");
      if (id === intoLeadId) throw invalid("intoLeadId", "Please choose a different lead.");
      if (!isUuid(id) || !isUuid(intoLeadId)) throw notFound();
      const scope = await leadScopeOf(context.principal);
      const now = clock.now();
      return repository.transaction(async (tx) => {
        const survivor = await loadChangeable(tx, intoLeadId, scope);
        const earlier = await repository.findMergeTarget(tx, id);
        if (earlier?.mergedIntoLeadId === intoLeadId) return toLeadView(survivor);
        await loadChangeable(tx, id, scope);
        await repository.moveLeadHistory(tx, id, intoLeadId);
        await alsoMove?.(tx, id, intoLeadId);
        await repository.updateLead(tx, id, { deletedAt: now, mergedIntoLeadId: intoLeadId });
        await repository.refreshNextFollowUp(tx, intoLeadId);
        await repository.touchActivity(tx, intoLeadId, now);
        await timeline(tx, {
          leadId: intoLeadId,
          kind: "LEAD_CREATED",
          summary: "Another lead was merged into this one",
          refType: "lead_merge",
          refId: id,
          actorUserId: context.principal.userId,
          occurredAt: now,
        });
        await audit(tx, context, "lead.merged", intoLeadId, "Leads merged", { mergedLeadId: id });
        return toLeadView(await loadLead(tx, intoLeadId, scope));
      });
    },

    /** For other modules' events. The same source event recorded twice appears once. */
    async recordTimelineEvent(entry: NewTimelineEntry): Promise<void> {
      await timeline(null, entry);
    },
  };
}

export const leadService = createLeadService();
