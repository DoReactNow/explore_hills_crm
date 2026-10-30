import { assignmentController } from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "leads:claim" },
  handler: assignmentController.listPool,
});
