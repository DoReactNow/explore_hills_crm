import { assignmentController, previewSchema } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "leads:assign" },
  input: previewSchema,
  handler: assignmentController.preview,
});
