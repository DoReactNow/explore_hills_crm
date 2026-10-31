// Browser adapters, kept apart from server ones so server code never reaches the browser bundle.
import { createFakeSoftphone } from "./fake/browser";
import type { SoftphoneFactory } from "./softphone";

const SOFTPHONES: Record<string, SoftphoneFactory> = { fake: createFakeSoftphone };

export const softphoneFor = (providerKey: string): SoftphoneFactory | null =>
  SOFTPHONES[providerKey] ?? null;
