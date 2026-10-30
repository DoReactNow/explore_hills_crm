// Prisma access to identity_users and the session revocation that goes with user changes.
// No business rules here. Nothing here deletes a user: accounts are only deactivated (Decision 22).
import type { Prisma } from "@/generated/prisma/client";
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
  role: { select: { code: true, name: true } },
} satisfies Prisma.IdentityUserSelect;

export type PublicUser = Prisma.IdentityUserGetPayload<{ select: typeof PUBLIC_USER }>;

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
        role: { select: { id: true, code: true, name: true, bypassesAccess: true } },
      },
    });
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

  async listUsers(skip: number, take: number): Promise<{ items: PublicUser[]; total: number }> {
    const prisma = getPrisma();
    const [items, total] = await Promise.all([
      prisma.identityUser.findMany({
        select: PUBLIC_USER,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip,
        take,
      }),
      prisma.identityUser.count(),
    ]);
    return { items, total };
  },

  getUser(id: string): Promise<PublicUser | null> {
    return getPrisma().identityUser.findUnique({ where: { id }, select: PUBLIC_USER });
  },
};

export type UserRepository = typeof userRepository;
