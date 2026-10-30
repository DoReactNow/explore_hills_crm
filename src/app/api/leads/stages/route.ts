import { leadsController } from "@/modules/leads/leads.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { anyOf: ["leads:view-own", "leads:view-team", "leads:view-all"] },
  handler: leadsController.listStages,
});
