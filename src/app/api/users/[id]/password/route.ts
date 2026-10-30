import { identityController, setPasswordSchema } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "users:edit" },
  input: setPasswordSchema,
  handler: identityController.setPassword,
});
