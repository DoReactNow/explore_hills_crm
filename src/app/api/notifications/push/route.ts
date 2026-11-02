import {
  notificationController,
  subscribeSchema,
  unsubscribeSchema,
} from "@/modules/notifications/notifications.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: "authenticated",
  rateLimit: RATE_LIMITS.admin,
  input: subscribeSchema,
  handler: notificationController.subscribe,
});

export const DELETE = route({
  access: "authenticated",
  input: unsubscribeSchema,
  handler: notificationController.unsubscribe,
});
