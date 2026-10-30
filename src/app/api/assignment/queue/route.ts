import { assignmentController, listQueueSchema } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "leads:assign" },
  input: listQueueSchema,
  handler: assignmentController.listQueue,
});
