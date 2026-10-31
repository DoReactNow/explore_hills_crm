// Picks the provider named by TELEPHONY_PROVIDER. A new adapter is added here and nowhere else.
import { getEnv } from "@/shared/config/env";
import { fakeProvider, signFakeCall } from "./fake/server";
import type { TelephonyProvider } from "./types";

const PROVIDERS: Record<string, TelephonyProvider> = { fake: fakeProvider };

export function getTelephonyProvider(): TelephonyProvider {
  const key = getEnv().TELEPHONY_PROVIDER;
  const provider = PROVIDERS[key];
  if (!provider) throw new Error(`No calling provider is built for TELEPHONY_PROVIDER="${key}"`);
  return provider;
}

/** Signs a pretend provider message. For the fake softphone only, which plays the provider's part. */
export const fakeProviderHeaders = (raw: string) =>
  new Headers({ "x-fake-signature": signFakeCall(raw) });
