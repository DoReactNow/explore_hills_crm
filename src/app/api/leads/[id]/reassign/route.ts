import { assignmentController, reassignSchema } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "leads:reassign" },
  input: reassignSchema,
  handler: assignmentController.reassign,
});
