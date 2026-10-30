import { mergeLeadSchema } from "@/modules/leads/leads.controller";
import { messagingController } from "@/modules/messaging/messaging.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "leads:merge" },
  input: mergeLeadSchema,
  handler: messagingController.mergeLeads,
});
