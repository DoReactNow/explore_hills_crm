import { assignmentController, autoRuleSchema } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "assignment:manage-rules" },
  handler: assignmentController.getAutoRule,
});

export const PUT = route({
  access: { permission: "assignment:manage-rules" },
  input: autoRuleSchema,
  handler: assignmentController.setAutoRule,
});
