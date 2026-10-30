import {
  agentSettingsSchema,
  assignmentController,
} from "@/modules/assignment/assignment.controller";
import { route } from "@/shared/http/route";

export const PUT = route({
  access: { permission: "assignment:manage-rules" },
  input: agentSettingsSchema,
  handler: assignmentController.updateAgentSettings,
});
