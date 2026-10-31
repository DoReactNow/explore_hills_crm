import { telephonyController, endCallSchema } from "@/modules/telephony/telephony.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "telephony:call" },
  input: endCallSchema,
  handler: telephonyController.endCall,
});
