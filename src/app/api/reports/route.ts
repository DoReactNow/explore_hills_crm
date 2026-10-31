import { reportFiltersSchema, reportingController } from "@/modules/reporting/reporting.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "reports:view" },
  input: reportFiltersSchema,
  handler: reportingController.getReport,
});
