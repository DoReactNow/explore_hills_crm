import {
  notificationController,
  subscribeSchema,
  unsubscribeSchema,
} from "@/modules/notifications/notifications.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: "authenticated",
  input: subscribeSchema,
  handler: notificationController.subscribe,
});

export const DELETE = route({
  access: "authenticated",
  input: unsubscribeSchema,
  handler: notificationController.unsubscribe,
});
