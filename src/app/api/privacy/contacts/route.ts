import { privacyController, searchSchema } from "@/modules/privacy/privacy.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "privacy:manage" },
  input: searchSchema,
  handler: privacyController.search,
});
