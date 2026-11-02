import { messagingController, sendTemplateSchema } from "@/modules/messaging/messaging.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "messaging:send" },
  rateLimit: RATE_LIMITS.send,
  input: sendTemplateSchema,
  handler: messagingController.sendTemplate,
});
