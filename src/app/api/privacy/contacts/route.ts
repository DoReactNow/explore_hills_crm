import { privacyController, searchSchema } from "@/modules/privacy/privacy.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "privacy:manage" },
  rateLimit: RATE_LIMITS.lookup,
  input: searchSchema,
  handler: privacyController.search,
});
