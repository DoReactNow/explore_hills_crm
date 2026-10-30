// Signing in and out (Decisions 46, 48, 49). An inactive account behaves exactly like an unknown
// email, and both lock like a real account, so no answer reveals which accounts exist. The answer
// is thrown only after its transaction commits, so failed attempts stay recorded.
import { createHmac } from "node:crypto";
import { recordAudit, type AuditInput, type AuditTx } from "@/modules/audit";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { systemClock, type Clock } from "@/shared/time";
import { hashSessionToken, newSessionToken, sessionExpiry } from "./identity.auth.helpers";
import { authRepository, type AuthRepository } from "./identity.auth.repository";
import { verifyPassword } from "./identity.passwords";
import type { SignInInput } from "./identity.schemas";
import type { PublicUser } from "./identity.users.repository";

const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 15;
const IP_ATTEMPTS_PER_WINDOW = 20;
const IP_WINDOW_MINUTES = 15;

interface AuthServiceDeps {
  repository?: AuthRepository;
  recordAudit?: (tx: AuditTx, input: AuditInput) => Promise<void>;
  verifyPassword?: (password: string, stored: string | null) => Promise<boolean>;
  clock?: Clock;
}

export interface SignInContext {
  ip: string;
  requestId?: string;
}

/** Keyed, so a leaked table cannot be checked against a list of addresses or emails. */
const throttleKey = (kind: "ip" | "email", value: string): string =>
  `${kind}:${createHmac("sha256", getEnv().AUTH_SECRET).update(value).digest("hex")}`;

const rateLimited = () => new AppError("RATE_LIMITED");
const invalidCredentials = () => new AppError("INVALID_CREDENTIALS");

export function createAuthService(deps: AuthServiceDeps = {}) {
  const repository = deps.repository ?? authRepository;
  const audit = deps.recordAudit ?? recordAudit;
  const verify = deps.verifyPassword ?? verifyPassword;
  const clock = deps.clock ?? systemClock;

  const failedEvent = (
    entity: { entityType: string; entityId: string },
    reason: string,
    requestId?: string,
  ): AuditInput => ({
    action: "auth.sign_in_failed",
    ...entity,
    summary: "Sign-in failed",
    actor: null,
    requestId,
    metadata: { reason },
  });

  async function refuseWithoutAccount(
    email: string,
    password: string,
    userId: string | undefined,
    requestId: string | undefined,
    now: Date,
  ): Promise<never> {
    const entity = userId
      ? { entityType: "user", entityId: userId }
      : { entityType: "auth", entityId: "unknown" };
    const reason = userId ? "inactive" : "unknown";
    const key = throttleKey("email", email);

    if (await repository.emailLocked(key, now, LOCK_AFTER_FAILURES, LOCK_MINUTES)) {
      throw rateLimited();
    }
    await verify(password, null);
    const count = await repository.transaction(async (tx) => {
      const failures = await repository.countEmailFailure(
        tx,
        key,
        now,
        LOCK_AFTER_FAILURES,
        LOCK_MINUTES,
      );
      await audit(tx, failedEvent(entity, reason, requestId));
      return failures;
    });
    throw count >= LOCK_AFTER_FAILURES ? rateLimited() : invalidCredentials();
  }

  return {
    async signIn(
      input: SignInInput,
      { ip, requestId }: SignInContext,
    ): Promise<{ user: PublicUser; token: string }> {
      const now = clock.now();
      const attempts = await repository.hitWindow(throttleKey("ip", ip), now, IP_WINDOW_MINUTES);
      if (attempts > IP_ATTEMPTS_PER_WINDOW) throw rateLimited();

      const email = input.email.trim().toLowerCase();
      const user = await repository.findUserForSignIn(email);
      if (!user || user.status !== "ACTIVE") {
        return refuseWithoutAccount(email, input.password, user?.id, requestId, now);
      }
      const entity = { entityType: "user", entityId: user.id };

      if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
        await repository.transaction((tx) => audit(tx, failedEvent(entity, "locked", requestId)));
        throw rateLimited();
      }

      if (!(await verify(input.password, user.passwordHash))) {
        const result = await repository.transaction(async (tx) => {
          const counted = await repository.countUserFailure(
            tx,
            user.id,
            now,
            LOCK_AFTER_FAILURES,
            LOCK_MINUTES,
          );
          await audit(tx, failedEvent(entity, "wrong_password", requestId));
          if (counted === "locked") {
            await audit(tx, {
              action: "auth.locked",
              ...entity,
              summary: "Account locked after too many wrong passwords",
              actor: null,
              requestId,
            });
          }
          return counted;
        });
        throw result === "counted" ? invalidCredentials() : rateLimited();
      }

      const token = newSessionToken();
      const signedIn = await repository.transaction(async (tx) => {
        const claimed = await repository.claimSignIn(tx, user.id, user.passwordHash, now);
        if (!claimed) return null;
        await repository.createSession(tx, {
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt: sessionExpiry(now, now),
          now,
        });
        await audit(tx, {
          action: "auth.signed_in",
          ...entity,
          summary: "Signed in",
          actor: { userId: user.id, roleCode: user.role.code },
          requestId,
        });
        return repository.getUser(tx, user.id);
      });
      if (signedIn) return { user: signedIn, token };

      // Something changed while the password was being checked.
      const lockedUntil = await repository.lockedUntilOf(user.id);
      throw lockedUntil && lockedUntil.getTime() > now.getTime()
        ? rateLimited()
        : invalidCredentials();
    },

    /** Ends this session only. Repeating it, or having no session, succeeds quietly. */
    async signOut(token: string | null, requestId?: string): Promise<void> {
      if (!token) return;
      await repository.transaction(async (tx) => {
        const owner = await repository.revokeSession(tx, hashSessionToken(token), clock.now());
        if (!owner) return;
        await audit(tx, {
          action: "auth.signed_out",
          entityType: "user",
          entityId: owner.id,
          summary: "Signed out",
          actor: { userId: owner.id, roleCode: owner.role.code },
          requestId,
        });
      });
    },
  };
}

export const authService = createAuthService();
