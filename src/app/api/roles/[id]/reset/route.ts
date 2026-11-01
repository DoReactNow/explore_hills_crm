import { identityController, resetRoleSchema } from "@/modules/identity/identity.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "roles:manage" },
  rateLimit: RATE_LIMITS.admin,
  input: resetRoleSchema,
  handler: identityController.resetRole,
});
