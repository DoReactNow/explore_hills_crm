import { leadsController, listFollowUpsSchema } from "@/modules/leads/leads.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { anyOf: ["leads:view-own", "leads:view-team", "leads:view-all"] },
  input: listFollowUpsSchema,
  handler: leadsController.listFollowUps,
});
