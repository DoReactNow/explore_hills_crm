import {
  messagingController,
  olderMessagesSchema,
  sendTextSchema,
} from "@/modules/messaging/messaging.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "messaging:view" },
  input: olderMessagesSchema,
  handler: messagingController.listOlderMessages,
});

export const POST = route({
  access: { permission: "messaging:send" },
  rateLimit: RATE_LIMITS.send,
  input: sendTextSchema,
  handler: messagingController.sendText,
});
