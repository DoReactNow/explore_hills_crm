import { identityController } from "@/modules/identity/identity.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "users:deactivate" },
  rateLimit: RATE_LIMITS.admin,
  handler: identityController.reactivateUser,
});
