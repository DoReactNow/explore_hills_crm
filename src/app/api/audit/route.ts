import { auditController, auditListSchema } from "@/modules/audit/audit.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "audit:view" },
  input: auditListSchema,
  handler: auditController.list,
});
