import { eraseSchema, privacyController } from "@/modules/privacy/privacy.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "privacy:erase" },
  input: eraseSchema,
  handler: privacyController.erase,
});
