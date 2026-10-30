// Team rules (Decision 55): a person may belong to several teams, names are unique in any case, and
// a team with members cannot be deleted until they have moved. Every change is audited.
import { recordAudit, type AuditAction, type AuditInput } from "@/modules/audit";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import { resolveScope } from "@/shared/rbac/scope";
import { isUuid, type UserContext } from "./identity.context";
import type { Tx } from "./identity.repository";
import type { CreateTeamInput, UpdateTeamInput } from "./identity.schemas";
import { teamRepository, type TeamView } from "./identity.teams.repository";
import { userRepository } from "./identity.users.repository";

const TEAM_SCOPE = { own: "teams:view", team: "teams:view", all: "teams:view-all" } as const;
const notFound = () => new AppError("NOT_FOUND");

function managerMustBeActive(): AppError {
  return new AppError("VALIDATION_FAILED", {
    fieldErrors: [
      { field: "managerUserId", message: "Please choose an active person as manager." },
    ],
  });
}

export function createTeamService(repository = teamRepository, users = userRepository) {
  const audit = (
    tx: Tx,
    { principal, requestId }: UserContext,
    action: AuditAction,
    entityId: string,
    summary: string,
    metadata?: AuditInput["metadata"],
  ) =>
    recordAudit(tx, {
      action,
      entityType: "team",
      entityId,
      summary,
      actor: { userId: principal.userId, roleCode: principal.roleCode },
      requestId,
      metadata,
    });

  async function assertActiveManager(tx: Tx, managerUserId: string | null | undefined) {
    if (!managerUserId) return;
    if (!isUuid(managerUserId)) throw managerMustBeActive();
    const manager = await users.findUserForChange(tx, managerUserId);
    if (manager?.status !== "ACTIVE") throw managerMustBeActive();
  }

  async function loadTeam(tx: Tx, id: string): Promise<TeamView> {
    if (!isUuid(id)) throw notFound();
    const team = await repository.getTeam(tx, id);
    if (!team) throw notFound();
    return team;
  }

  /** Changing a Super Admin's teams changes their account, so it needs the reserved code. */
  async function loadMemberTarget(tx: Tx, { principal }: UserContext, userId: string) {
    if (!isUuid(userId)) throw notFound();
    const target = await users.findUserForChange(tx, userId);
    if (!target) throw notFound();
    if (target.role.bypassesAccess) assertCan(principal, "users:manage-super-admins");
    return target;
  }

  return {
    async listTeams({ principal }: UserContext): Promise<TeamView[]> {
      assertCan(principal, "teams:view");
      const scope = resolveScope(principal, TEAM_SCOPE);
      return repository.listTeams(
        scope === "all" ? "all" : await users.visibleUserIds(principal.userId),
      );
    },

    async getTeam({ principal }: UserContext, id: string): Promise<TeamView> {
      assertCan(principal, "teams:view");
      const team = await repository.transaction((tx) => loadTeam(tx, id));
      if (resolveScope(principal, TEAM_SCOPE) === "all") return team;
      const visible = new Set(await users.visibleUserIds(principal.userId));
      const inBranch =
        (team.manager && visible.has(team.manager.id)) ||
        team.members.some(({ user }) => visible.has(user.id));
      if (!inBranch) throw notFound();
      return team;
    },

    async createTeam(context: UserContext, input: CreateTeamInput): Promise<TeamView> {
      assertCan(context.principal, "teams:manage");
      return repository.transaction(async (tx) => {
        await assertActiveManager(tx, input.managerUserId);
        const team = await repository.createTeam(tx, {
          name: input.name,
          managerUserId: input.managerUserId ?? null,
        });
        await audit(tx, context, "team.created", team.id, "Team created");
        return team;
      });
    },

    async updateTeam(context: UserContext, id: string, input: UpdateTeamInput): Promise<TeamView> {
      assertCan(context.principal, "teams:manage");
      return repository.transaction(async (tx) => {
        const team = await loadTeam(tx, id);
        await assertActiveManager(tx, input.managerUserId);
        const changed: string[] = [];
        if (input.name !== undefined && input.name !== team.name) changed.push("name");
        if (
          input.managerUserId !== undefined &&
          input.managerUserId !== (team.manager?.id ?? null)
        ) {
          changed.push("manager");
        }
        if (changed.length === 0) return team;
        const updated = await repository.updateTeam(tx, id, {
          name: input.name,
          managerUserId: input.managerUserId,
        });
        await audit(tx, context, "team.updated", id, "Team updated", { changed });
        return updated;
      });
    },

    async deleteTeam(context: UserContext, id: string): Promise<void> {
      assertCan(context.principal, "teams:manage");
      const inUse = () =>
        new AppError("CONFLICT", {
          fieldErrors: [
            { field: "_root", message: "Move this team's members to another team first." },
          ],
        });
      try {
        await repository.transaction(async (tx) => {
          const team = await loadTeam(tx, id);
          if (team.members.length > 0) throw inUse();
          await repository.deleteTeam(tx, id);
          await audit(tx, context, "team.deleted", id, "Team deleted");
        });
      } catch (error) {
        // A member added at the same moment trips the foreign key instead.
        if ((error as { code?: unknown }).code === "P2003") throw inUse();
        throw error;
      }
    },

    async addMember(context: UserContext, id: string, userId: string): Promise<TeamView> {
      assertCan(context.principal, "teams:manage");
      return repository.transaction(async (tx) => {
        await loadTeam(tx, id);
        const target = await loadMemberTarget(tx, context, userId);
        if (await repository.addMember(tx, id, target.id)) {
          await audit(tx, context, "team.member_added", id, "Team member added", {
            userId: target.id,
          });
        }
        return loadTeam(tx, id);
      });
    },

    async removeMember(context: UserContext, id: string, userId: string): Promise<TeamView> {
      assertCan(context.principal, "teams:manage");
      return repository.transaction(async (tx) => {
        await loadTeam(tx, id);
        const target = await loadMemberTarget(tx, context, userId);
        if (await repository.removeMember(tx, id, target.id)) {
          await audit(tx, context, "team.member_removed", id, "Team member removed", {
            userId: target.id,
          });
        }
        return loadTeam(tx, id);
      });
    },
  };
}

export const teamService = createTeamService();
