import { holdSchema, privacyController } from "@/modules/privacy/privacy.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "privacy:manage" },
  input: holdSchema,
  handler: privacyController.setHold,
});
