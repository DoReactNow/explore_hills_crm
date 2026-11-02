import { messagingController } from "@/modules/messaging/messaging.controller";
import { RATE_LIMITS } from "@/shared/http/rateLimit";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "messaging:view" },
  rateLimit: RATE_LIMITS.file,
  handler: messagingController.openFile,
});
