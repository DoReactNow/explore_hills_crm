import { telephonyController } from "@/modules/telephony/telephony.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "telephony:view-recordings" },
  rateLimit: RATE_LIMITS.file,
  handler: telephonyController.playRecording,
});
