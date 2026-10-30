import { identityController, signInSchema } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: "public",
  input: signInSchema,
  handler: identityController.signIn,
});
