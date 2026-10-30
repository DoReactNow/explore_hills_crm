import {
  createLeadSchema,
  leadsController,
  listLeadsSchema,
} from "@/modules/leads/leads.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { anyOf: ["leads:view-own", "leads:view-team", "leads:view-all"] },
  input: listLeadsSchema,
  handler: leadsController.listLeads,
});

export const POST = route({
  access: { permission: "leads:create" },
  input: createLeadSchema,
  handler: leadsController.createLead,
});
