import { assignmentController, deactivateSchema } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "users:deactivate" },
  input: deactivateSchema,
  handler: assignmentController.deactivateUser,
});
