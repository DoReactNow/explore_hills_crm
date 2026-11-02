import { privacyController } from "@/modules/privacy/privacy.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "privacy:export" },
  rateLimit: RATE_LIMITS.export,
  handler: privacyController.exportData,
});
