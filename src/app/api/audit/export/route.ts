import { auditController, auditFiltersSchema } from "@/modules/audit/audit.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "audit:export" },
  input: auditFiltersSchema,
  handler: auditController.exportCsv,
});
