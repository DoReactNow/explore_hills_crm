import { telephonyController } from "@/modules/telephony/telephony.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: "public",
  rateLimit: RATE_LIMITS.webhook,
  handler: telephonyController.receiveWebhook,
});
