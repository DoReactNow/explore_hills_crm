import { createTeamSchema, identityController } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "teams:view" },
  handler: identityController.listTeams,
});

export const POST = route({
  access: { permission: "teams:manage" },
  input: createTeamSchema,
  handler: identityController.createTeam,
});
