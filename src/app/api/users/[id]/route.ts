import { identityController, updateUserSchema } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "users:view" },
  handler: identityController.getUser,
});

export const PATCH = route({
  access: { permission: "users:edit" },
  input: updateUserSchema,
  handler: identityController.updateUser,
});
