import {
  listNotificationsSchema,
  notificationController,
} from "@/modules/notifications/notifications.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: "authenticated",
  input: listNotificationsSchema,
  handler: notificationController.list,
});
