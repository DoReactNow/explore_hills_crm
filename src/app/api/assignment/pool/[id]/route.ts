import { assignmentController } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const DELETE = route({
  access: { permission: "leads:assign" },
  handler: assignmentController.cancelPoolEntry,
});
