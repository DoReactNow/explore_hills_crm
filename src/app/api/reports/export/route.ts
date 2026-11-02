import { exportSchema, reportingController } from "@/modules/reporting/reporting.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "reports:export" },
  rateLimit: RATE_LIMITS.export,
  input: exportSchema,
  handler: reportingController.exportCsv,
});
