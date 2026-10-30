// Picks the gateway named by WHATSAPP_GATEWAY. A real adapter is added here when the route is chosen.
import { getEnv } from "@/shared/config/env";
import { fakeGateway } from "./fake";
import type { WhatsAppGateway } from "./types";

const GATEWAYS: Record<string, WhatsAppGateway> = { fake: fakeGateway };

export function getWhatsAppGateway(): WhatsAppGateway {
  const key = getEnv().WHATSAPP_GATEWAY;
  const gateway = GATEWAYS[key];
  if (!gateway) throw new Error(`No WhatsApp gateway is built for WHATSAPP_GATEWAY="${key}"`);
  return gateway;
}
