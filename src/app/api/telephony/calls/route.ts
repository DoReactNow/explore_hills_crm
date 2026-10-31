import { telephonyController, listCallsSchema } from "@/modules/telephony/telephony.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "telephony:call" },
  input: listCallsSchema,
  handler: telephonyController.listCalls,
});
