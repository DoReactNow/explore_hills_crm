import { identityController, updateTeamSchema } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "teams:view" },
  handler: identityController.getTeam,
});

export const PATCH = route({
  access: { permission: "teams:manage" },
  input: updateTeamSchema,
  handler: identityController.updateTeam,
});

export const DELETE = route({
  access: { permission: "teams:manage" },
  handler: identityController.deleteTeam,
});
