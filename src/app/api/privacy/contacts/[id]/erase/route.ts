import { eraseSchema, privacyController } from "@/modules/privacy/privacy.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "privacy:erase" },
  rateLimit: RATE_LIMITS.privacy,
  input: eraseSchema,
  handler: privacyController.erase,
});
