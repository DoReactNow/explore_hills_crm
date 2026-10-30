// Resolves each request from its session cookie to the user's principal (Decisions 4 and 46).
// The principal is rebuilt every time, so a role or permission change applies on the next request.
import { readSessionToken } from "@/shared/http/sessionCookie";
import type { PrincipalResolver } from "@/shared/rbac/principalResolver";
import { instantFromEpochMs, systemClock, type Clock } from "@/shared/time";
import { hashSessionToken, sessionExpiry } from "./identity.auth.helpers";
import { authRepository, type AuthRepository } from "./identity.auth.repository";
import { principalFromRole } from "./identity.service";

const EXTEND_AT_MOST_EVERY_MS = 5 * 60 * 1000;

export function createSessionPrincipalResolver({
  repository = authRepository,
  clock = systemClock,
}: { repository?: AuthRepository; clock?: Clock } = {}): PrincipalResolver {
  return async ({ headers }) => {
    const token = readSessionToken(headers);
    if (!token) return null;

    const session = await repository.findSessionForPrincipal(hashSessionToken(token));
    if (!session || session.revokedAt || session.user.status !== "ACTIVE") return null;

    const now = clock.now();
    if (session.expiresAt.getTime() <= now.getTime()) return null;

    const seenBefore = instantFromEpochMs(now.getTime() - EXTEND_AT_MOST_EVERY_MS);
    if (session.lastSeenAt.getTime() <= seenBefore.getTime()) {
      await repository.extendSession(session.id, {
        seenBefore,
        now,
        expiresAt: sessionExpiry(session.createdAt, now),
      });
    }
    return principalFromRole(session.user.id, session.user.role);
  };
}
