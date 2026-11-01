// Reading the audit trail. It reads people, leads and contacts for display and search (Decision 22),
// and writes nothing.
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";

export interface AuditWhere {
  actorIds: readonly string[] | null;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  start?: Date;
  end?: Date;
  search?: string;
  searchEntityIds?: readonly string[];
}

const toWhere = (where: AuditWhere): Prisma.AuditEventWhereInput => ({
  AND: [
    where.actorIds ? { actorUserId: { in: [...where.actorIds] } } : {},
    where.actorId === "system" ? { actorUserId: null } : {},
    where.actorId && where.actorId !== "system" ? { actorUserId: where.actorId } : {},
    where.action ? { action: where.action } : {},
    where.entityType ? { entityType: where.entityType } : {},
    where.entityId ? { entityId: where.entityId } : {},
    where.start ? { occurredAt: { gte: where.start } } : {},
    where.end ? { occurredAt: { lt: where.end } } : {},
    where.search
      ? {
          OR: [
            { summary: { contains: where.search, mode: "insensitive" } },
            { entityId: where.search },
            { entityId: { in: [...(where.searchEntityIds ?? [])] } },
          ],
        }
      : {},
  ],
});

export const auditViewsRepository = {
  list(where: AuditWhere, after: string | undefined, take: number) {
    return getPrisma().auditEvent.findMany({
      where: toWhere(where),
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: {
        id: true,
        occurredAt: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        actorRoleCode: true,
        actor: { select: { id: true, name: true, status: true } },
      },
    });
  },

  /** Everyone who appears in the trail, deactivated people too. */
  async actors(actorIds: readonly string[] | null) {
    const rows = await getPrisma().auditEvent.findMany({
      where: {
        actorUserId: actorIds ? { in: [...actorIds] } : { not: null },
      },
      distinct: ["actorUserId"],
      select: { actor: { select: { id: true, name: true, status: true } } },
    });
    return rows
      .flatMap((row) => (row.actor ? [row.actor] : []))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** The leads and contacts a name or number matches, so searching for a person finds their records. */
  async recordsMatching(search: string, take: number): Promise<string[]> {
    const digits = search.replace(/\D/g, "");
    const contacts = await getPrisma().leadsContact.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          ...(digits.length >= 4 ? [{ phoneE164: { contains: digits } }] : []),
        ],
      },
      take,
      select: { id: true, leads: { select: { id: true } } },
    });
    const users = await getPrisma().identityUser.findMany({
      where: { name: { contains: search, mode: "insensitive" } },
      take,
      select: { id: true },
    });
    return [
      ...contacts.flatMap((contact) => [contact.id, ...contact.leads.map((lead) => lead.id)]),
      ...users.map((user) => user.id),
    ];
  },
};
