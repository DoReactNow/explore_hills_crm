import {
  identityController,
  createUserSchema,
  listUsersSchema,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "users:view" },
  input: listUsersSchema,
  handler: identityController.listUsers,
});

export const POST = route({
  access: { permission: "users:create" },
  input: createUserSchema,
  handler: identityController.createUser,
});
