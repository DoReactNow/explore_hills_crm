import { identityController } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const DELETE = route({
  access: { permission: "teams:manage" },
  handler: identityController.removeTeamMember,
});
