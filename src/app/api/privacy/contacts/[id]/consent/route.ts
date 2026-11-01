import { consentSchema, privacyController } from "@/modules/privacy/privacy.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "privacy:manage" },
  rateLimit: RATE_LIMITS.privacy,
  input: consentSchema,
  handler: privacyController.recordConsent,
});
