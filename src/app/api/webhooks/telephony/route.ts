import { telephonyController } from "@/modules/telephony/telephony.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: "public",
  handler: telephonyController.receiveWebhook,
});
