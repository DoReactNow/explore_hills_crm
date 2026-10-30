// Prisma access to identity_teams and identity_team_members. No business rules here.
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import type { Tx } from "./identity.repository";

const TEAM_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  manager: { select: { id: true, name: true, status: true } },
  members: {
    orderBy: { user: { name: "asc" } },
    select: {
      user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } },
    },
  },
} as const;

export interface TeamView {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  manager: { id: string; name: string; status: string } | null;
  members: Array<{
    user: { id: string; name: string; email: string; status: string; lastLoginAt: Date | null };
  }>;
}

const nameTaken = () =>
  new AppError("CONFLICT", {
    fieldErrors: [{ field: "name", message: "A team with that name already exists." }],
  });

async function translatingNameConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if ((error as { code?: unknown }).code === "P2002") throw nameTaken();
    throw error;
  }
}

export const teamRepository = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work);
  },

  listTeams(visibleUserIds: readonly string[] | "all"): Promise<TeamView[]> {
    return getPrisma().identityTeam.findMany({
      where:
        visibleUserIds === "all"
          ? {}
          : {
              OR: [
                { managerUserId: { in: [...visibleUserIds] } },
                { members: { some: { userId: { in: [...visibleUserIds] } } } },
              ],
            },
      select: TEAM_SELECT,
      orderBy: { name: "asc" },
    });
  },

  getTeam(tx: Tx, id: string): Promise<TeamView | null> {
    return tx.identityTeam.findUnique({ where: { id }, select: TEAM_SELECT });
  },

  createTeam(tx: Tx, data: { name: string; managerUserId: string | null }): Promise<TeamView> {
    return translatingNameConflict(() => tx.identityTeam.create({ data, select: TEAM_SELECT }));
  },

  updateTeam(
    tx: Tx,
    id: string,
    data: { name?: string; managerUserId?: string | null },
  ): Promise<TeamView> {
    return translatingNameConflict(() =>
      tx.identityTeam.update({ where: { id }, data, select: TEAM_SELECT }),
    );
  },

  async deleteTeam(tx: Tx, id: string): Promise<void> {
    await tx.identityTeam.delete({ where: { id } });
  },

  async addMember(tx: Tx, teamId: string, userId: string): Promise<boolean> {
    const { count } = await tx.identityTeamMember.createMany({
      data: [{ teamId, userId }],
      skipDuplicates: true,
    });
    return count === 1;
  },

  async removeMember(tx: Tx, teamId: string, userId: string): Promise<boolean> {
    const { count } = await tx.identityTeamMember.deleteMany({ where: { teamId, userId } });
    return count === 1;
  },

  async existingTeamIds(tx: Tx, ids: readonly string[]): Promise<string[]> {
    const rows = await tx.identityTeam.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },
};

export type TeamRepository = typeof teamRepository;
