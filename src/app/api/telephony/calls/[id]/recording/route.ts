import { telephonyController } from "@/modules/telephony/telephony.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "telephony:view-recordings" },
  handler: telephonyController.playRecording,
});
