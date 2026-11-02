import { assignmentController, reassignSchema } from "@/modules/assignment/assignment.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "leads:reassign" },
  rateLimit: RATE_LIMITS.write,
  input: reassignSchema,
  handler: assignmentController.reassign,
});
