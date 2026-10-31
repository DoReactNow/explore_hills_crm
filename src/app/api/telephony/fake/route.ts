import { fakeControlSchema, telephonyController } from "@/modules/telephony/telephony.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: "authenticated",
  input: fakeControlSchema,
  handler: telephonyController.fakeControl,
});
