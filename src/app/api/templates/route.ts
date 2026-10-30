import {
  createTemplateSchema,
  listTemplatesSchema,
  messagingController,
} from "@/modules/messaging/messaging.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { anyOf: ["messaging:send", "messaging:manage-templates"] },
  input: listTemplatesSchema,
  handler: messagingController.listTemplates,
});

export const POST = route({
  access: { permission: "messaging:manage-templates" },
  input: createTemplateSchema,
  handler: messagingController.createTemplate,
});
