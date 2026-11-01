import { startCallSchema, telephonyController } from "@/modules/telephony/telephony.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: "authenticated",
  handler: telephonyController.listLeadCalls,
});

export const POST = route({
  access: { permission: "telephony:call" },
  rateLimit: RATE_LIMITS.call,
  input: startCallSchema,
  handler: telephonyController.startCall,
});
