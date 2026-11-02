// Starts the watching inside a process: errors from any process, the checks from each app instance.
// Instances can't double-raise, because only one alert can be open per problem.
import { logger, setErrorListener } from "@/shared/logger";
import { monitoringService } from "./monitoring.service";
import { CHECK_EVERY_MS } from "./monitoring.types";

const holder = globalThis as unknown as { explorehillsMonitorTimer?: NodeJS.Timeout };

export function trackErrors(source: "app" | "worker"): void {
  setErrorListener((record) => void monitoringService.recordError(record, source));
}

export function startChecks(): void {
  if (holder.explorehillsMonitorTimer) return;
  holder.explorehillsMonitorTimer = setInterval(() => {
    monitoringService
      .runChecks()
      .catch((error: unknown) => logger.warn("monitoring checks failed", { err: error }));
  }, CHECK_EVERY_MS);
  holder.explorehillsMonitorTimer.unref();
}
