import {
  messagingController,
  updateTemplateSchema,
} from "@/modules/messaging/messaging.controller";
import { route } from "@/shared/http/route";

export const PATCH = route({
  access: { permission: "messaging:manage-templates" },
  input: updateTemplateSchema,
  handler: messagingController.updateTemplate,
});

export const DELETE = route({
  access: { permission: "messaging:manage-templates" },
  handler: messagingController.deleteTemplate,
});
