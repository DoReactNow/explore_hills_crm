import { mergeLeadSchema } from "@/modules/leads/leads.controller";
import { messagingController } from "@/modules/messaging/messaging.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "leads:merge" },
  rateLimit: RATE_LIMITS.write,
  input: mergeLeadSchema,
  handler: messagingController.mergeLeads,
});
