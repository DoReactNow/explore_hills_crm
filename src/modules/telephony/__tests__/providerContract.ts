// What every calling provider must do (Decision 24, P7-DRIVER-01). A real adapter adds its own recorded
// webhook samples and runs this same suite. No test ever calls a real provider.
import { describe, expect, it } from "vitest";
import { instantFromEpochMs } from "@/shared/time";
import { CALL_STATUSES } from "../telephony.types";
import type { TelephonyProvider } from "../providers/types";

export interface ProviderSamples {
  /** Signs a body the way this provider does. */
  sign(raw: string): Headers;
  /** One recorded sample for each status, with what it must map to. */
  statuses: Array<{ body: unknown; expected: (typeof CALL_STATUSES)[number] }>;
  unknownStatus: unknown;
  recordingReady: unknown;
  junk: unknown[];
  inbound: { body: unknown; phone: string | null };
}

export function runProviderContract(provider: TelephonyProvider, samples: ProviderSamples) {
  describe(`calling provider "${provider.key}"`, () => {
    it("declares every capability", () => {
      expect(Object.keys(provider.capabilities).sort()).toEqual(
        [
          "browserCalling",
          "clickToCall",
          "dualChannelRecording",
          "inboundRouting",
          "liveStatusEvents",
          "recording",
        ].sort(),
      );
    });

    it("refuses a bad or missing signature, and accepts a good one (P7-CALLHOOK-01)", () => {
      const raw = JSON.stringify(samples.recordingReady);
      expect(provider.verifyWebhook(raw, samples.sign(raw))).toBe(true);
      expect(provider.verifyWebhook(`${raw} `, samples.sign(raw))).toBe(false);
      expect(provider.verifyWebhook(raw, new Headers())).toBe(false);
    });

    it("maps each status onto one of ours (P7-CALLHOOK-07)", () => {
      for (const { body, expected } of samples.statuses) {
        const [event] = provider.parseWebhook(body);
        expect(event).toMatchObject({ kind: "status", status: expected });
      }
    });

    it("gives a safe null for a status it doesn't know (P7-CALLHOOK-06)", () => {
      const [event] = provider.parseWebhook(samples.unknownStatus);
      expect(event).toMatchObject({ kind: "status", status: null });
    });

    it("reports a ready recording, and gives each event a stable key (P7-CALLHOOK-02)", () => {
      const [first] = provider.parseWebhook(samples.recordingReady);
      const [second] = provider.parseWebhook(samples.recordingReady);
      expect(first.kind).toBe("recording");
      expect(first.key).toBe(second.key);
    });

    it("ignores junk rather than throwing", () => {
      for (const body of samples.junk) expect(provider.parseWebhook(body)).toEqual([]);
    });

    it("reads an inbound routing request", () => {
      expect(provider.parseInboundRequest(samples.inbound.body)?.customerPhone).toBe(
        samples.inbound.phone,
      );
    });

    it("issues a credential that expires, different for each agent (P7-CALL-06)", async () => {
      const now = instantFromEpochMs(1_000_000);
      const one = await provider.issueAgentCredentials({ userId: "agent-1", now });
      const two = await provider.issueAgentCredentials({ userId: "agent-2", now });
      expect(one.token).not.toBe(two.token);
      expect(one.expiresAt.getTime()).toBeGreaterThan(now.getTime());
      expect(one.expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(60 * 60 * 1000);
    });
  });
}
