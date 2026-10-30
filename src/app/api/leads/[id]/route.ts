import { leadsController, updateLeadSchema } from "@/modules/leads/leads.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { anyOf: ["leads:view-own", "leads:view-team", "leads:view-all"] },
  handler: leadsController.getLead,
});

export const PATCH = route({
  access: { permission: "leads:edit" },
  input: updateLeadSchema,
  handler: leadsController.updateLead,
});

export const DELETE = route({
  access: { permission: "leads:delete" },
  handler: leadsController.deleteLead,
});
