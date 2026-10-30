// Prisma access for signing in: sessions, failed-attempt counters and the throttle table. The
// counters are single atomic statements, so simultaneous attempts cannot slip past a limit.
import { getPrisma } from "@/shared/db/prisma";
import type { Tx } from "./identity.repository";
import { PUBLIC_USER, type PublicUser } from "./identity.users.repository";

export const authRepository = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work);
  },

  findUserForSignIn(email: string) {
    return getPrisma().identityUser.findUnique({
      where: { email },
      select: {
        id: true,
        status: true,
        passwordHash: true,
        lockedUntil: true,
        role: { select: { code: true } },
      },
    });
  },

  async lockedUntilOf(id: string): Promise<Date | null> {
    const row = await getPrisma().identityUser.findUnique({
      where: { id },
      select: { lockedUntil: true },
    });
    return row?.lockedUntil ?? null;
  },

  /** Adds one to a window counter, starting a new window once the old one has passed. */
  async hitWindow(key: string, now: Date, windowMinutes: number): Promise<number> {
    const rows = await getPrisma().$queryRaw<Array<{ count: number }>>`
      INSERT INTO identity_login_throttle AS t (key, "windowStart", count, "updatedAt")
      VALUES (${key}, ${now}::timestamptz, 1, ${now}::timestamptz)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN t."windowStart" + make_interval(mins => ${windowMinutes}::int) <= ${now}::timestamptz
                     THEN 1 ELSE t.count + 1 END,
        "windowStart" = CASE WHEN t."windowStart" + make_interval(mins => ${windowMinutes}::int) <= ${now}::timestamptz
                             THEN ${now}::timestamptz ELSE t."windowStart" END,
        "updatedAt" = ${now}::timestamptz
      RETURNING count`;
    return rows[0].count;
  },

  /** Failures for an email with no usable account. `windowStart` holds when the lock began. */
  async countEmailFailure(
    tx: Tx,
    key: string,
    now: Date,
    lockAfter: number,
    lockMinutes: number,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ count: number }>>`
      INSERT INTO identity_login_throttle AS t (key, "windowStart", count, "updatedAt")
      VALUES (${key}, ${now}::timestamptz, 1, ${now}::timestamptz)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN t.count >= ${lockAfter}::int
           AND t."windowStart" + make_interval(mins => ${lockMinutes}::int) <= ${now}::timestamptz THEN 1
          WHEN t.count >= ${lockAfter}::int THEN t.count
          ELSE t.count + 1 END,
        "windowStart" = CASE
          WHEN t.count >= ${lockAfter}::int
           AND t."windowStart" + make_interval(mins => ${lockMinutes}::int) > ${now}::timestamptz THEN t."windowStart"
          ELSE ${now}::timestamptz END,
        "updatedAt" = ${now}::timestamptz
      RETURNING count`;
    return rows[0].count;
  },

  /** True when this email has a lock still running. */
  async emailLocked(
    key: string,
    now: Date,
    lockAfter: number,
    lockMinutes: number,
  ): Promise<boolean> {
    const rows = await getPrisma().$queryRaw<Array<{ locked: boolean }>>`
      SELECT count >= ${lockAfter}::int
             AND "windowStart" + make_interval(mins => ${lockMinutes}::int) > ${now}::timestamptz AS locked
      FROM identity_login_throttle WHERE key = ${key}`;
    return rows[0]?.locked ?? false;
  },

  /**
   * Counts one wrong password, unless a lock is running (guesses never extend it). An ended lock
   * starts the count again. Returns whether this attempt set the lock, or "already" if one ran.
   */
  async countUserFailure(
    tx: Tx,
    id: string,
    now: Date,
    lockAfter: number,
    lockMinutes: number,
  ): Promise<"counted" | "locked" | "already"> {
    const rows = await tx.$queryRaw<Array<{ lockedUntil: Date | null }>>`
      UPDATE identity_users SET
        "failedLoginCount" = CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedLoginCount" + 1 END,
        "lockedUntil" = CASE
          WHEN "lockedUntil" IS NULL AND "failedLoginCount" + 1 >= ${lockAfter}::int
          THEN ${now}::timestamptz + make_interval(mins => ${lockMinutes}::int)
          ELSE NULL END,
        "updatedAt" = ${now}::timestamptz
      WHERE id = ${id}::uuid AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now}::timestamptz)
      RETURNING "lockedUntil"`;
    if (rows.length === 0) return "already";
    return rows[0].lockedUntil ? "locked" : "counted";
  },

  /**
   * Marks the sign-in, only if the account is still active and unlocked and still has the password
   * that was just checked, so a change at the same moment shuts the old password out (P1-PASS-09).
   */
  async claimSignIn(tx: Tx, id: string, passwordHash: string, now: Date): Promise<boolean> {
    const { count } = await tx.identityUser.updateMany({
      where: {
        id,
        passwordHash,
        status: "ACTIVE",
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    return count === 1;
  },

  async createSession(
    tx: Tx,
    data: { userId: string; tokenHash: string; expiresAt: Date; now: Date },
  ): Promise<void> {
    const { now, ...session } = data;
    await tx.identitySession.create({ data: { ...session, lastSeenAt: now, createdAt: now } });
  },

  /** Ends a session if it is still running; returns who it belonged to. */
  async revokeSession(tx: Tx, tokenHash: string, now: Date) {
    const { count } = await tx.identitySession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count === 0) return null;
    const session = await tx.identitySession.findUniqueOrThrow({
      where: { tokenHash },
      select: { user: { select: { id: true, role: { select: { code: true } } } } },
    });
    return session.user;
  },

  /** A session with the user and role grants needed to build the principal on every request. */
  findSessionForPrincipal(tokenHash: string) {
    return getPrisma().identitySession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        expiresAt: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            status: true,
            role: {
              select: {
                code: true,
                bypassesAccess: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
  },

  /** Conditional, so requests arriving together cause one write. True if this one wrote. */
  async extendSession(
    id: string,
    data: { seenBefore: Date; now: Date; expiresAt: Date },
  ): Promise<boolean> {
    const { count } = await getPrisma().identitySession.updateMany({
      where: { id, revokedAt: null, lastSeenAt: { lte: data.seenBefore } },
      data: { lastSeenAt: data.now, expiresAt: data.expiresAt },
    });
    return count === 1;
  },

  getUser(tx: Tx, id: string): Promise<PublicUser> {
    return tx.identityUser.findUniqueOrThrow({ where: { id }, select: PUBLIC_USER });
  },
};

export type AuthRepository = typeof authRepository;
