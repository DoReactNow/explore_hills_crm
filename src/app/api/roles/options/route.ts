import { identityController } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { anyOf: ["users:create", "users:edit"] },
  handler: identityController.roleOptions,
});
