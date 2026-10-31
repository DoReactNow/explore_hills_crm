// The daily deletion of old messages and webhook logs (P10-ERASE-09): by business day, in small batches,
// and safe to run twice. A file goes on the deletion list in the same transaction as its message.
import { recordAudit, type AuditAction } from "@/modules/audit";
import { enqueueFileDeletions, getSetting, runFileDeletions } from "@/modules/system";
import {
  addBusinessDays,
  businessDayRange,
  systemClock,
  todayBusinessDate,
  type Clock,
} from "@/shared/time";
import { messagingRepository as repository } from "./messaging.repository";

const BATCH_SIZE = 500;
/** A limit per run: anything left waits for tomorrow's run. */
const MAX_BATCHES = 200;

export function createMessagingRetention(clock: Clock = systemClock) {
  /** The start of the oldest business day still kept. */
  const cutoff = (days: number) =>
    businessDayRange(addBusinessDays(todayBusinessDate(clock), -days)).start;

  const note = (action: AuditAction, entityType: string, summary: string, count: number) =>
    repository.transaction((tx) =>
      recordAudit(tx, {
        action,
        entityType,
        entityId: "retention",
        summary,
        actor: null,
        metadata: { count },
      }),
    );

  return {
    async deleteOldMessages(): Promise<number> {
      const before = cutoff((await getSetting("retention.messageDays")) as number);
      let deleted = 0;
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const rows = await repository.oldMessages(before, BATCH_SIZE);
        if (rows.length === 0) break;
        await repository.transaction(async (tx) => {
          await enqueueFileDeletions(
            tx,
            rows.flatMap((row) =>
              row.mediaStatus === "STORED" && row.mediaRef ? [row.mediaRef] : [],
            ),
            "message retention",
          );
          await repository.deleteMessages(
            tx,
            rows.map((row) => row.id),
          );
        });
        deleted += rows.length;
        if (rows.length < BATCH_SIZE) break;
      }
      if (deleted > 0) {
        await note(
          "retention.messages_deleted",
          "messaging_messages",
          "Old WhatsApp messages deleted",
          deleted,
        );
        await runFileDeletions();
      }
      return deleted;
    },

    async deleteOldWebhookEvents(): Promise<number> {
      const before = cutoff((await getSetting("retention.webhookEventDays")) as number);
      let deleted = 0;
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const count = await repository.deleteOldWebhookEvents(before, BATCH_SIZE);
        deleted += count;
        if (count < BATCH_SIZE) break;
      }
      if (deleted > 0) {
        await note(
          "retention.webhook_logs_deleted",
          "messaging_webhook_events",
          "Old WhatsApp webhook logs deleted",
          deleted,
        );
      }
      return deleted;
    },
  };
}

export const messagingRetention = createMessagingRetention();
