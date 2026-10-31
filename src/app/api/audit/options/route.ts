import { auditController } from "@/modules/audit/audit.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "audit:view" },
  handler: auditController.options,
});
