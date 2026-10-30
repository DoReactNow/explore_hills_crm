import { identityController, teamMemberSchema } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "teams:manage" },
  input: teamMemberSchema,
  handler: identityController.addTeamMember,
});
