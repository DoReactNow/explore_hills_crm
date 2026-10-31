// A live notice to one person only (Decision 28): it carries no content, and the screen re-reads.
import { z } from "zod";
import { defineEventType } from "@/shared/realtime";

export const notificationsChangedEvent = defineEventType({
  name: "notifications.changed",
  payload: z.object({ userId: z.string() }),
  canReceive: async (principal, { userId }) => principal.userId === userId,
});

export const notificationEventTypes = [notificationsChangedEvent];
