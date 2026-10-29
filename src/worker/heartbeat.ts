// Writes the worker heartbeat now and then every `intervalMs` (shown on the diagnostics page).
import { recordWorkerHeartbeat } from "@/modules/system";
import { logger } from "@/shared/logger";
import { systemClock } from "@/shared/time";

export async function startHeartbeat({
  workerId,
  intervalMs,
}: {
  workerId: string;
  intervalMs: number;
}) {
  const startedAt = systemClock.now();
  const beat = () => recordWorkerHeartbeat({ workerId, startedAt });
  await beat();
  const timer = setInterval(() => {
    beat().catch((error: unknown) =>
      logger.error("worker heartbeat failed", { err: error, workerId }),
    );
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
