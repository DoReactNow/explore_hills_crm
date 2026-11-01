import { identityController, setPasswordSchema } from "@/modules/identity/identity.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "users:edit" },
  rateLimit: RATE_LIMITS.password,
  input: setPasswordSchema,
  handler: identityController.setPassword,
});
