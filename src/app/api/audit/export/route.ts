import { auditController, auditFiltersSchema } from "@/modules/audit/audit.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "audit:export" },
  rateLimit: RATE_LIMITS.export,
  input: auditFiltersSchema,
  handler: auditController.exportCsv,
});
