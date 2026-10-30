import { createRoleSchema, identityController } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "roles:manage" },
  handler: identityController.listRoles,
});

export const POST = route({
  access: { permission: "roles:manage" },
  input: createRoleSchema,
  handler: identityController.createRole,
});
