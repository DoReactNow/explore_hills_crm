import { startCallSchema, telephonyController } from "@/modules/telephony/telephony.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: "authenticated",
  handler: telephonyController.listLeadCalls,
});

export const POST = route({
  access: { permission: "telephony:call" },
  input: startCallSchema,
  handler: telephonyController.startCall,
});
