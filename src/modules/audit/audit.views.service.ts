// The audit trail screens: read only, by design (P10-AUDV-03). Nothing here changes an event; the only
// write is the line recording that the trail was exported. Who can be seen follows the permission:
// everyone with audit:view-all, otherwise the person and those below them, without automatic actions.
import { getVisibleAgentIds } from "@/modules/identity";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { CSV_BOM, csvRow } from "@/shared/http/csv";
import { assertCan } from "@/shared/rbac/assertCan";
import type { Principal } from "@/shared/rbac/principal";
import type { ScopePermissions } from "@/shared/rbac/scope";
import { addBusinessDays, businessDayRange, formatInstant } from "@/shared/time";
import { auditService } from "./audit.service";
import type { AuditFilters, AuditListInput } from "./audit.schemas";
import { AUDIT_ACTIONS } from "./audit.types";
import { auditViewsRepository as repository, type AuditWhere } from "./audit.views.repository";

const PAGE_SIZE = 50;
const EXPORT_BATCH = 1000;
const SEARCH_MATCHES = 50;
const AUDIT_SCOPE: ScopePermissions = {
  own: "audit:view",
  team: "audit:view",
  all: "audit:view-all",
};

const actorLabel = (actor: { name: string; status: string } | null) =>
  actor ? actor.name : "System";

async function resolveWhere(principal: Principal, filters: AuditFilters): Promise<AuditWhere> {
  const visible = await getVisibleAgentIds(principal, AUDIT_SCOPE);
  const actorIds = visible === "all" ? null : visible;
  if (filters.from && filters.to && filters.to < filters.from) {
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "to", message: "The end date can't be before the start date." }],
    });
  }
  return {
    actorIds,
    actorId: filters.actorId,
    action: filters.action,
    entityType: filters.entityType,
    entityId: filters.entityId,
    start: filters.from ? businessDayRange(filters.from).start : undefined,
    end: filters.to ? businessDayRange(addBusinessDays(filters.to, 1)).start : undefined,
    search: filters.search,
    searchEntityIds: filters.search
      ? await repository.recordsMatching(filters.search, SEARCH_MATCHES)
      : undefined,
  };
}

export const auditViewsService = {
  async list(principal: Principal, input: AuditListInput) {
    assertCan(principal, "audit:view");
    const { after, ...filters } = input;
    const rows = await repository.list(
      await resolveWhere(principal, filters),
      after,
      PAGE_SIZE + 1,
    );
    return {
      events: rows.slice(0, PAGE_SIZE),
      nextAfter: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].id : null,
    };
  },

  async options(principal: Principal) {
    assertCan(principal, "audit:view");
    const visible = await getVisibleAgentIds(principal, AUDIT_SCOPE);
    return {
      actors: await repository.actors(visible === "all" ? null : visible),
      actions: AUDIT_ACTIONS,
      includesSystem: visible === "all",
    };
  },

  async exportCsv(principal: Principal, requestId: string | undefined, filters: AuditFilters) {
    assertCan(principal, "audit:view");
    assertCan(principal, "audit:export");
    const where = await resolveWhere(principal, filters);
    await getPrisma().$transaction((tx) =>
      auditService.recordAudit(tx, {
        action: "audit.exported",
        entityType: "audit_events",
        entityId: "export",
        summary: "Audit trail exported",
        actor: { userId: principal.userId, roleCode: principal.roleCode },
        requestId,
        metadata: { from: filters.from ?? null, to: filters.to ?? null },
      }),
    );
    const encoder = new TextEncoder();
    const lines = async function* (): AsyncGenerator<string> {
      yield CSV_BOM;
      yield csvRow(["When", "Who", "Role", "Action", "What happened", "Record", "Record ID"]);
      let after: string | undefined;
      for (;;) {
        const page: Awaited<ReturnType<typeof repository.list>> = await repository.list(
          where,
          after,
          EXPORT_BATCH,
        );
        for (const event of page) {
          yield csvRow([
            formatInstant(event.occurredAt, "dateTime"),
            actorLabel(event.actor),
            event.actorRoleCode,
            event.action,
            event.summary,
            event.entityType,
            event.entityId,
          ]);
        }
        if (page.length < EXPORT_BATCH) return;
        after = page[page.length - 1].id;
      }
    };
    const source = lines();
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await source.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(next.value));
        },
      }),
      {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="audit-trail.csv"',
          "cache-control": "private, no-store",
        },
      },
    );
  },
};
