// Removes old sessions and sign-in counters, so the tables stay small and hashed IP data is not
// kept longer than needed. Live sessions are never touched.
import { instantFromEpochMs, systemClock, type Clock } from "@/shared/time";
import { authRepository, type AuthRepository } from "./identity.auth.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_KEEP_MS = 7 * DAY_MS;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_KEEP_MS = DAY_MS;

export function createCleanupService(
  repository: Pick<AuthRepository, "deleteOldSessions" | "deleteOldThrottleRows"> = authRepository,
  clock: Clock = systemClock,
) {
  return {
    async run(): Promise<{ sessions: number; throttleRows: number }> {
      const now = clock.now().getTime();
      const sessions = await repository.deleteOldSessions(
        instantFromEpochMs(now - SESSION_KEEP_MS),
      );
      const throttleRows = await repository.deleteOldThrottleRows(
        instantFromEpochMs(now - THROTTLE_KEEP_MS - THROTTLE_WINDOW_MS),
      );
      return { sessions, throttleRows };
    },
  };
}
