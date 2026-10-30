import { identityController, resetRoleSchema } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "roles:manage" },
  input: resetRoleSchema,
  handler: identityController.resetRole,
});
