import { createRoleSchema, identityController } from "@/modules/identity/identity.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "roles:manage" },
  handler: identityController.listRoles,
});

export const POST = route({
  access: { permission: "roles:manage" },
  rateLimit: RATE_LIMITS.admin,
  input: createRoleSchema,
  handler: identityController.createRole,
});
