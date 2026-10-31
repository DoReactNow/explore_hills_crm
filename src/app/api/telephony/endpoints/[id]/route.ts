import { telephonyController, endpointSchema } from "@/modules/telephony/telephony.controller";
import { route } from "@/shared/http/route";

export const PUT = route({
  access: { permission: "users:edit" },
  input: endpointSchema,
  handler: telephonyController.saveEndpoint,
});
