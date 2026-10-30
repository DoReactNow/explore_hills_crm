import { leadsController, setTaskSchema } from "@/modules/leads/leads.controller";
import { route } from "@/shared/http/route";

export const PATCH = route({
  access: { permission: "leads:edit" },
  input: setTaskSchema,
  handler: leadsController.setTask,
});
