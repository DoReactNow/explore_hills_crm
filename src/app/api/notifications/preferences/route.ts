import {
  notificationController,
  preferencesSchema,
} from "@/modules/notifications/notifications.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: "authenticated",
  handler: notificationController.getPreferences,
});

export const PUT = route({
  access: { permission: "notifications:mute" },
  input: preferencesSchema,
  handler: notificationController.setPreferences,
});
