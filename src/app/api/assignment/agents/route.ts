import { assignmentController } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: {
    anyOf: ["leads:assign", "leads:reassign", "assignment:manage-rules", "users:deactivate"],
  },
  handler: assignmentController.listAgents,
});
