import { notificationController } from "@/modules/notifications/notifications.controller";
import { route } from "@/shared/http/route";

export const POST = route({ access: "authenticated", handler: notificationController.markRead });
