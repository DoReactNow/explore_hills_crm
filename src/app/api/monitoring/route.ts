import { monitoringController } from "@/modules/monitoring/monitoring.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "system:view-diagnostics" },
  handler: monitoringController.view,
});
