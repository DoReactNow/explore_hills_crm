// The pipeline stage list is configuration (project_data.md 3.1). Reordering changes display and
// funnel order only; history stores names and codes at the time. NEW, and the last stage of each
// closed kind, always stay active, so a lead can always start and close.
import { randomBytes } from "node:crypto";
import { recordAudit, type AuditAction, type AuditInput } from "@/modules/audit";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import { isUuid, type LeadContext } from "./leads.service";
import { leadRepository } from "./leads.repository";
import type { CreateStageInput, UpdateStageInput } from "./leads.schemas";
import type { Tx } from "./leads.repository";

const DEFAULT_STAGES = [
  { code: "NEW", name: "New", position: 10, kind: "OPEN" },
  { code: "CONTACTED", name: "Contacted", position: 20, kind: "OPEN" },
  { code: "QUALIFIED", name: "Qualified", position: 30, kind: "OPEN" },
  { code: "QUOTED", name: "Quote sent", position: 40, kind: "OPEN" },
  { code: "WON", name: "Booked", position: 90, kind: "WON" },
  { code: "LOST", name: "Lost", position: 99, kind: "LOST" },
] as const;

export const ensureDefaultStages = () => leadRepository.seedStages(DEFAULT_STAGES);

const refused = (message: string, field = "_root") =>
  new AppError("CONFLICT", { fieldErrors: [{ field, message }] });
const nameTaken = () => refused("A stage with that name already exists.", "name");
const notFound = () => new AppError("NOT_FOUND");

function codeFromName(name: string): string {
  const code = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[A-Z]/.test(code) ? code : `STAGE_${randomBytes(4).toString("hex").toUpperCase()}`;
}

const prisma = () => getPrisma();

export function createStageService() {
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
      entityType: "stage",
      entityId,
      summary,
      actor: { userId: principal.userId, roleCode: principal.roleCode },
      requestId,
      metadata,
    });

  async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
    const clash = await tx.leadsPipelineStage.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw nameTaken();
  }

  return {
    listStages: () => leadRepository.listStages(),

    async createStage(context: LeadContext, input: CreateStageInput) {
      assertCan(context.principal, "settings:manage");
      try {
        return await prisma().$transaction(async (tx) => {
          await assertNameFree(tx, input.name);
          const stage = await tx.leadsPipelineStage.create({
            data: { code: codeFromName(input.name), name: input.name, position: input.position },
          });
          await audit(tx, context, "stage.created", stage.id, "Stage created");
          return stage;
        });
      } catch (error) {
        if ((error as { code?: unknown }).code === "P2002") throw nameTaken();
        throw error;
      }
    },

    async updateStage(context: LeadContext, id: string, input: UpdateStageInput) {
      assertCan(context.principal, "settings:manage");
      if (!isUuid(id)) throw notFound();
      return prisma().$transaction(async (tx) => {
        const stage = await tx.leadsPipelineStage.findUnique({ where: { id } });
        if (!stage) throw notFound();
        if (input.name) await assertNameFree(tx, input.name, id);
        if (input.isActive === false && stage.isActive) {
          if (stage.code === "NEW") throw refused("Every new enquiry starts in this stage.");
          if (stage.kind !== "OPEN") {
            const others = await tx.leadsPipelineStage.count({
              where: { kind: stage.kind, isActive: true, id: { not: id } },
            });
            if (others === 0) throw refused("Leads need this stage to close.");
          }
        }
        const updated = await tx.leadsPipelineStage.update({ where: { id }, data: input });
        await audit(tx, context, "stage.updated", id, "Stage updated", {
          changed: Object.keys(input),
        });
        return updated;
      });
    },

    async deleteStage(context: LeadContext, id: string): Promise<void> {
      assertCan(context.principal, "settings:manage");
      if (!isUuid(id)) throw notFound();
      const inUse = () => refused("Leads have used this stage. Switch it off instead.");
      try {
        await prisma().$transaction(async (tx) => {
          const stage = await tx.leadsPipelineStage.findUnique({
            where: { id },
            select: { code: true, kind: true, _count: { select: { leads: true } } },
          });
          if (!stage) throw notFound();
          if (stage.code === "NEW" || stage.kind !== "OPEN") {
            throw refused("This built-in stage can't be deleted.");
          }
          if (stage._count.leads > 0) throw inUse();

          await tx.leadsPipelineStage.delete({ where: { id } });
          await audit(tx, context, "stage.deleted", id, "Stage deleted");
        });
      } catch (error) {
        if ((error as { code?: unknown }).code === "P2003") throw inUse();
        throw error;
      }
    },
  };
}

export const stageService = createStageService();
