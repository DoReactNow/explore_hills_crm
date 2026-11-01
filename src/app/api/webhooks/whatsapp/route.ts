import { messagingController } from "@/modules/messaging/messaging.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({ access: "public", handler: messagingController.webhookHandshake });

export const POST = route({
  access: "public",
  rateLimit: RATE_LIMITS.webhook,
  handler: messagingController.receiveWebhook,
});
