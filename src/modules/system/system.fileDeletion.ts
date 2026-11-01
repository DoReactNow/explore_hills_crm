// Deleting files for good (P10-ERASE-02). The wish to delete is written in the same transaction as the
// change that makes a file unwanted, so a storage outage can only delay it. Rows go only once the file
// has gone, and a job keeps trying; a file that keeps failing raises an alert and stays on the list.
import { logger } from "@/shared/logger";
import { getFileStorage } from "@/shared/storage";
import { systemClock, type Clock } from "@/shared/time";
import {
  fileDeletionRepository,
  type FileDeletionRepository,
  type FileDeletionTx,
} from "./system.fileDeletion.repository";

const BATCH = 500;
const ALERT_AFTER_ATTEMPTS = 12;

export function createFileDeletionService(
  repository: FileDeletionRepository = fileDeletionRepository,
  storage: () => { delete(key: string): Promise<void> } = getFileStorage,
  clock: Clock = systemClock,
) {
  return {
    enqueue: (tx: FileDeletionTx, keys: readonly string[], reason: string) =>
      repository.enqueue(tx, keys, reason, clock.now()),

    /** One pass over the list. A failure stays listed for the next pass and stops nothing else. */
    async run(): Promise<{ deleted: number; failed: number }> {
      let deleted = 0;
      let failed = 0;
      for (const row of await repository.next(BATCH)) {
        try {
          await storage().delete(row.storageKey);
          await repository.done(row.id);
          deleted += 1;
        } catch (error) {
          failed += 1;
          await repository.failed(row.id, error instanceof Error ? error.message : "failed");
          if (row.attempts + 1 >= ALERT_AFTER_ATTEMPTS) {
            logger.error("ALERT: a file could not be deleted", {
              fileDeletionId: row.id,
              attempts: row.attempts + 1,
              err: error,
            });
          }
        }
      }
      return { deleted, failed };
    },

    pendingCount: () => repository.count(),
  };
}

export const fileDeletionService = createFileDeletionService();
export const enqueueFileDeletions = fileDeletionService.enqueue;
export const runFileDeletions = fileDeletionService.run;
export const pendingFileDeletions = fileDeletionService.pendingCount;
