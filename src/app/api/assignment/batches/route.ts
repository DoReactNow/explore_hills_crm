import { assignmentController, commitSchema } from "@/modules/assignment/assignment.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "leads:assign" },
  rateLimit: RATE_LIMITS.write,
  input: commitSchema,
  handler: assignmentController.commit,
});
