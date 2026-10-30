import { createStageSchema, leadsController } from "@/modules/leads/leads.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "settings:manage" },
  handler: leadsController.listStages,
});

export const POST = route({
  access: { permission: "settings:manage" },
  input: createStageSchema,
  handler: leadsController.createStage,
});
