import { leadsController, addTaskSchema } from "@/modules/leads/leads.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "leads:edit" },
  input: addTaskSchema,
  handler: leadsController.addTask,
});
