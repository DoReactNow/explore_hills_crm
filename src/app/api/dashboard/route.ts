import { dashboardSchema, reportingController } from "@/modules/reporting/reporting.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: {
    anyOf: ["dashboard:view-own", "dashboard:view-team", "dashboard:view-all"],
  },
  input: dashboardSchema,
  handler: reportingController.getDashboard,
});
