import { privacyController } from "@/modules/privacy/privacy.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "privacy:export" },
  handler: privacyController.exportData,
});
