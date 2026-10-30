import { messagingController } from "@/modules/messaging/messaging.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "messaging:view" },
  handler: messagingController.getConversation,
});
