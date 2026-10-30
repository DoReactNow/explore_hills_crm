import { leadsController, updateStageSchema } from "@/modules/leads/leads.controller";
import { route } from "@/shared/http/route";

export const PATCH = route({
  access: { permission: "settings:manage" },
  input: updateStageSchema,
  handler: leadsController.updateStage,
});

export const DELETE = route({
  access: { permission: "settings:manage" },
  handler: leadsController.deleteStage,
});
