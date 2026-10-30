import { messagingController } from "@/modules/messaging/messaging.controller";
import { route } from "@/shared/http/route";

export const GET = route({ access: "public", handler: messagingController.webhookHandshake });

export const POST = route({ access: "public", handler: messagingController.receiveWebhook });
