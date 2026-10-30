import { assignmentController } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "leads:assign" },
  handler: assignmentController.undo,
});
