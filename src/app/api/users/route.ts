import {
  identityController,
  createUserSchema,
  listUsersSchema,
} from "@/modules/identity/identity.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "users:view" },
  input: listUsersSchema,
  handler: identityController.listUsers,
});

export const POST = route({
  access: { permission: "users:create" },
  rateLimit: RATE_LIMITS.admin,
  input: createUserSchema,
  handler: identityController.createUser,
});
