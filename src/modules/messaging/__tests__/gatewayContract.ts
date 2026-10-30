// The contract every WhatsApp gateway must pass (P4-GATE-01). A real adapter runs this with recorded
// webhooks and a stubbed network, so no test ever calls a real API.
import { describe, expect, it } from "vitest";
import type { WhatsAppGateway } from "../gateway/types";

export interface GatewayFixture {
  make: () => WhatsAppGateway;
  sign: (rawBody: string) => string;
  validToken: string;
  /** One text message and one delivered status, in the provider's own format. */
  webhook: string;
}

export function gatewayContract(name: string, fixture: GatewayFixture) {
  describe(`WhatsApp gateway contract: ${name}`, () => {
    const signed = (signature: string | null) =>
      new Headers(signature ? { "x-hub-signature-256": signature } : {});

    it("accepts the right signature only, on the exact body", () => {
      const gateway = fixture.make();
      const body = fixture.webhook;
      expect(gateway.verifySignature(body, signed(fixture.sign(body)))).toBe(true);
      expect(gateway.verifySignature(`${body} `, signed(fixture.sign(body)))).toBe(false);
      expect(gateway.verifySignature(body, signed("sha256=wrong"))).toBe(false);
      expect(gateway.verifySignature(body, signed(null))).toBe(false);
    });

    it("accepts the right handshake token only", () => {
      const gateway = fixture.make();
      expect(gateway.verifyHandshake(fixture.validToken)).toBe(true);
      expect(gateway.verifyHandshake("wrong")).toBe(false);
      expect(gateway.verifyHandshake(null)).toBe(false);
    });

    it("turns a webhook into events with stable keys", () => {
      const events = fixture.make().parseWebhook(JSON.parse(fixture.webhook));
      expect(events.map((event) => event.kind).sort()).toEqual(["message", "status"]);
      const again = fixture.make().parseWebhook(JSON.parse(fixture.webhook));
      expect(again.map((event) => event.key)).toEqual(events.map((event) => event.key));
    });

    it("never throws on rubbish", () => {
      const gateway = fixture.make();
      for (const body of [null, 1, "x", [], {}, { entry: 1 }, { entry: [{ changes: [null] }] }]) {
        expect(gateway.parseWebhook(body)).toEqual([]);
      }
    });

    it("returns a provider ID for each kind of send", async () => {
      const gateway = fixture.make();
      const results = await Promise.all([
        gateway.sendText({ to: "919000000001", body: "Hi", clientRef: "a" }),
        gateway.sendTemplate({
          to: "919000000001",
          name: "t",
          language: "en",
          variables: [],
          clientRef: "b",
        }),
        gateway.sendMedia({
          to: "919000000001",
          bytes: new Uint8Array([1]),
          mimeType: "image/png",
          filename: "a.png",
          caption: null,
          clientRef: "c",
        }),
      ]);
      for (const result of results) expect(result.providerMessageId).toBeTruthy();
    });
  });
}
