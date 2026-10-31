import {
  messagingController,
  olderMessagesSchema,
  sendTextSchema,
} from "@/modules/messaging/messaging.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "messaging:view" },
  input: olderMessagesSchema,
  handler: messagingController.listOlderMessages,
});

export const POST = route({
  access: { permission: "messaging:send" },
  input: sendTextSchema,
  handler: messagingController.sendText,
});
