import { messagingController } from "@/modules/messaging/messaging.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "messaging:send" },
  handler: messagingController.sendFile,
});
