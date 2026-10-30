import { identityController, updateRoleSchema } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const PATCH = route({
  access: { permission: "roles:manage" },
  input: updateRoleSchema,
  handler: identityController.updateRole,
});

export const DELETE = route({
  access: { permission: "roles:manage" },
  handler: identityController.deleteRole,
});
