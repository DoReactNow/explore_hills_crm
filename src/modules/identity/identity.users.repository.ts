// Prisma access to identity_users and the session revocation that goes with user changes.
// No business rules here. Nothing here deletes a user: accounts are only deactivated (Decision 22).
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import type { Tx } from "./identity.repository";
import type { IdentityUserStatus } from "./identity.types";

// An arbitrary fixed key: all user changes queue on it, so the "last active Super Admin" count
// cannot be read by two transactions at once (P1-SUPER-05).
const USER_CHANGES_LOCK = 7_104_001;

export const PUBLIC_USER = {
  id: true,
  email: true,
  name: true,
  phoneE164: true,
  status: true,
  lastLoginAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { code: true, name: true, bypassesAccess: true } },
  manager: { select: { id: true, name: true } },
  teamMemberships: {
    orderBy: { team: { name: "asc" } },
    select: { team: { select: { id: true, name: true } } },
  },
} satisfies Prisma.IdentityUserSelect;

export type PublicUser = Prisma.IdentityUserGetPayload<{ select: typeof PUBLIC_USER }>;

/** What leaves the server: the role's bypass flag stays inside (the guard's business, not the UI's). */
export function toUserView(user: PublicUser) {
  const { code, name } = user.role;
  return { ...user, role: { code, name } };
}

export type UserView = ReturnType<typeof toUserView>;

export interface UserListQuery {
  skip: number;
  take: number;
  visibleIds: readonly string[] | "all";
  search?: string;
  roleCode?: string;
  teamId?: string;
  status?: IdentityUserStatus;
  sort: "name" | "role" | "team" | "manager" | "status" | "lastLoginAt";
  direction: "asc" | "desc";
}

export interface RoleForChange {
  id: string;
  code: string;
  name: string;
  bypassesAccess: boolean;
}

export interface NewUser {
  email: string;
  name: string;
  phoneE164: string | null;
  passwordHash: string;
  status: IdentityUserStatus;
  roleId: string;
}

export type UserChanges = Partial<{
  email: string;
  name: string;
  phoneE164: string | null;
  roleId: string;
  managerId: string | null;
  passwordHash: string;
  status: IdentityUserStatus;
  deactivatedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
}>;

async function translatingEmailConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if ((error as { code?: unknown }).code === "P2002") {
      throw new AppError("CONFLICT", {
        fieldErrors: [{ field: "email", message: "That email is already in use." }],
      });
    }
    throw error;
  }
}

export const userRepository = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work);
  },

  async lockUserChanges(tx: Tx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${USER_CHANGES_LOCK}::bigint)`;
  },

  findRoleByCode(tx: Tx, code: string): Promise<RoleForChange | null> {
    return tx.identityRole.findUnique({
      where: { code },
      select: { id: true, code: true, name: true, bypassesAccess: true },
    });
  },

  findUserForChange(tx: Tx, id: string) {
    return tx.identityUser.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phoneE164: true,
        status: true,
        managerId: true,
        role: { select: { id: true, code: true, name: true, bypassesAccess: true } },
        teamMemberships: { select: { teamId: true } },
      },
    });
  },

  findUserByEmail(email: string) {
    return getPrisma().identityUser.findUnique({
      where: { email },
      select: { id: true, name: true, role: { select: { bypassesAccess: true } } },
    });
  },

  async findBypassRoleCode(): Promise<string | null> {
    const role = await getPrisma().identityRole.findFirst({
      where: { bypassesAccess: true },
      select: { code: true },
    });
    return role?.code ?? null;
  },

  countActiveSuperAdmins(tx: Tx): Promise<number> {
    return tx.identityUser.count({ where: { status: "ACTIVE", role: { bypassesAccess: true } } });
  },

  insertUser(tx: Tx, data: NewUser): Promise<PublicUser> {
    return translatingEmailConflict(() => tx.identityUser.create({ data, select: PUBLIC_USER }));
  },

  updateUser(tx: Tx, id: string, data: UserChanges): Promise<PublicUser> {
    return translatingEmailConflict(() =>
      tx.identityUser.update({ where: { id }, data, select: PUBLIC_USER }),
    );
  },

  async revokeSessions(tx: Tx, userId: string, at: Date): Promise<void> {
    await tx.identitySession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  },

  /**
   * One page, filtered and sorted in SQL so every column sorts correctly, including those that come
   * from another table. `visibleIds` limits it to a person's branch.
   */
  async listUsers(query: UserListQuery): Promise<{
    items: PublicUser[];
    total: number;
    statusCounts: Record<string, number>;
  }> {
    const prisma = getPrisma();
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.visibleIds !== "all") {
      conditions.push(Prisma.sql`u.id = ANY(${[...query.visibleIds]}::uuid[])`);
    }
    if (query.roleCode) conditions.push(Prisma.sql`r.code = ${query.roleCode}`);
    if (query.teamId) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM identity_team_members m
        WHERE m."userId" = u.id AND m."teamId"::text = ${query.teamId})`);
    }
    if (query.search) {
      const like = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(Prisma.sql`(u.name ILIKE ${like} OR u.email ILIKE ${like}
        OR COALESCE(u."phoneE164", '') ILIKE ${like})`);
    }
    const unfiltered = Prisma.join(conditions, " AND ");
    const where = query.status
      ? Prisma.sql`${unfiltered} AND u.status::text = ${query.status}`
      : unfiltered;
    const from = Prisma.sql`FROM identity_users u
      JOIN identity_roles r ON r.id = u."roleId"
      LEFT JOIN identity_users mgr ON mgr.id = u."managerId"`;
    const order = Prisma.raw(query.direction === "desc" ? "DESC" : "ASC");
    const sortColumn = {
      name: Prisma.sql`lower(u.name)`,
      role: Prisma.sql`lower(r.name)`,
      manager: Prisma.sql`lower(mgr.name)`,
      status: Prisma.sql`u.status::text`,
      lastLoginAt: Prisma.sql`u."lastLoginAt"`,
      team: Prisma.sql`(SELECT min(lower(t.name)) FROM identity_team_members m
        JOIN identity_teams t ON t.id = m."teamId" WHERE m."userId" = u.id)`,
    }[query.sort];

    const [rows, counts, byStatus] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string }>>`SELECT u.id ${from} WHERE ${where}
        ORDER BY ${sortColumn} ${order} NULLS LAST, u.id ASC
        LIMIT ${query.take} OFFSET ${query.skip}`,
      prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count ${from} WHERE ${where}`,
      prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT u.status::text AS status, count(*) AS count ${from} WHERE ${unfiltered}
        GROUP BY u.status`,
    ]);
    const found = await prisma.identityUser.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: PUBLIC_USER,
    });
    const byId = new Map(found.map((user) => [user.id, user]));
    return {
      items: rows.flatMap((row) => byId.get(row.id) ?? []),
      total: Number(counts[0].count),
      statusCounts: Object.fromEntries(byStatus.map((row) => [row.status, Number(row.count)])),
    };
  },

  /**
   * The person and everyone below them: through reporting lines, and through the teams each person
   * manages, all the way down (Decision 55). UNION makes it safe even if a loop ever existed.
   */
  /** Active people whose role holds a permission. Goes by the grant, so never by a role's name. */
  listActiveHolders(code: string, ids: readonly string[] | "all", tx?: Tx) {
    return (tx ?? getPrisma()).identityUser.findMany({
      where: {
        status: "ACTIVE",
        role: { permissions: { some: { permission: { code } } } },
        ...(ids === "all" ? {} : { id: { in: [...ids] } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  },

  async visibleUserIds(rootId: string): Promise<string[]> {
    const rows = await getPrisma().$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE visible(id) AS (
        SELECT ${rootId}::uuid
        UNION
        SELECT u.id FROM visible v
        JOIN identity_users u ON u."managerId" = v.id OR EXISTS (
          SELECT 1 FROM identity_team_members m
          JOIN identity_teams t ON t.id = m."teamId"
          WHERE m."userId" = u.id AND t."managerUserId" = v.id
        )
      )
      SELECT id FROM visible`;
    return rows.map((row) => row.id);
  },

  /** True when `candidateManagerId` already reports, at any depth, to `userId`. */
  async reportsTo(tx: Tx, candidateManagerId: string, userId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ found: boolean }>>`
      WITH RECURSIVE chain(id, "managerId") AS (
        SELECT id, "managerId" FROM identity_users WHERE id = ${candidateManagerId}::uuid
        UNION
        SELECT u.id, u."managerId" FROM identity_users u JOIN chain c ON u.id = c."managerId"
      )
      SELECT EXISTS (SELECT 1 FROM chain WHERE id = ${userId}::uuid) AS found`;
    return rows[0].found;
  },

  /** What still depends on this person as a manager. */
  async supervisionOf(tx: Tx, userId: string): Promise<{ reports: number; teams: number }> {
    const [reports, teams] = await Promise.all([
      tx.identityUser.count({ where: { managerId: userId, status: { not: "DEACTIVATED" } } }),
      tx.identityTeam.count({ where: { managerUserId: userId } }),
    ]);
    return { reports, teams };
  },

  async setTeams(tx: Tx, userId: string, teamIds: readonly string[]): Promise<void> {
    await tx.identityTeamMember.deleteMany({ where: { userId } });
    if (teamIds.length > 0) {
      await tx.identityTeamMember.createMany({
        data: teamIds.map((teamId) => ({ teamId, userId })),
      });
    }
  },

  async existingTeamIds(tx: Tx, ids: readonly string[]): Promise<string[]> {
    const rows = await tx.identityTeam.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  getUser(id: string): Promise<PublicUser | null> {
    return getPrisma().identityUser.findUnique({ where: { id }, select: PUBLIC_USER });
  },
};

export type UserRepository = typeof userRepository;
