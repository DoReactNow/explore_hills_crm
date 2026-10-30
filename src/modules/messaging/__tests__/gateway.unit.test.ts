import { beforeEach, describe, expect, it } from "vitest";
import { instantFromEpochMs, toIsoInstant } from "@/shared/time";
import {
  fakeGateway,
  FAKE_VERIFY_TOKEN,
  fakeInboundWebhook,
  fakeWhatsApp,
  signFake,
} from "../gateway/fake";
import { parseMetaWebhook } from "../gateway/metaFormat";
import { GatewayError } from "../gateway/types";
import { gatewayContract } from "./gatewayContract";

gatewayContract("fake", {
  make: () => fakeGateway,
  sign: signFake,
  validToken: FAKE_VERIFY_TOKEN,
  webhook: JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "x", display_phone_number: "1" },
              messages: [
                {
                  id: "m1",
                  from: "919000000001",
                  timestamp: "1793000000",
                  type: "text",
                  text: { body: "Hi" },
                },
              ],
              statuses: [{ id: "m9", status: "delivered", timestamp: "1793000000" }],
            },
          },
        ],
      },
    ],
  }),
});

const FROM = "919000000001";
const message = (extra: Record<string, unknown>) =>
  parseMetaWebhook(
    JSON.parse(
      fakeInboundWebhook(
        [{ id: "m1", from: FROM, timestamp: "1793000000", ...extra }],
        [{ wa_id: FROM, name: "Riya" }],
      ),
    ),
  )[0] as unknown as Record<string, unknown>;

describe("reading each kind of message (P4-INBOUND-04)", () => {
  it.each([
    ["text", { type: "text", text: { body: "Hi" } }, "TEXT", "Hi"],
    [
      "image",
      { type: "image", image: { id: "i1", mime_type: "image/jpeg", caption: "Look" } },
      "IMAGE",
      "Look",
    ],
    [
      "document",
      { type: "document", document: { id: "d1", mime_type: "application/pdf", filename: "a.pdf" } },
      "DOCUMENT",
      null,
    ],
    ["audio", { type: "audio", audio: { id: "a1", mime_type: "audio/ogg" } }, "AUDIO", null],
    ["video", { type: "video", video: { id: "v1", mime_type: "video/mp4" } }, "VIDEO", null],
    [
      "location",
      { type: "location", location: { name: "Gulmarg", latitude: 1, longitude: 2 } },
      "INTERACTIVE",
      "Shared a location: Gulmarg",
    ],
    [
      "contact",
      { type: "contacts", contacts: [{ name: { formatted_name: "Anil" } }] },
      "INTERACTIVE",
      "Shared a contact: Anil",
    ],
    ["reaction", { type: "reaction", reaction: { emoji: "👍" } }, "INTERACTIVE", "Reacted 👍"],
    ["button", { type: "button", button: { text: "YES" } }, "INTERACTIVE", "YES"],
    ["unsupported", { type: "order" }, "UNSUPPORTED", null],
  ])("%s", (_name, extra, type, body) => {
    expect(message(extra)).toMatchObject({ type, body });
  });

  it("keeps the reply reference, profile name and provider time", () => {
    expect(message({ type: "text", text: { body: "x" }, context: { id: "m0" } })).toMatchObject({
      replyToWaId: "m0",
      profileName: "Riya",
      occurredAt: toIsoInstant(instantFromEpochMs(1793000000000)),
    });
  });

  it("marks a message from the business number or a group as ignorable (P4-INBOUND-08)", () => {
    expect(message({ type: "text", text: { body: "x" } }).ignorable).toBe(false);
    expect(message({ type: "text", text: { body: "x" }, group_id: "g1" }).ignorable).toBe(true);
    const own = parseMetaWebhook(
      JSON.parse(
        fakeInboundWebhook([
          {
            id: "m2",
            from: "919000099999",
            timestamp: "1793000000",
            type: "text",
            text: { body: "x" },
          },
        ]),
      ),
    );
    expect(own[0]).toMatchObject({ ignorable: true });
  });

  it("reads a whole batch, leaving out only what it can't read (P4-WEBHOOK-05, -06)", () => {
    const events = parseMetaWebhook(
      JSON.parse(
        fakeInboundWebhook([
          { id: "m1", from: FROM, timestamp: "1793000000", type: "text", text: { body: "a" } },
          { from: FROM }, // no ID
          { id: "m3", from: FROM, timestamp: "1793000000", type: "text", text: { body: "b" } },
        ]),
      ),
    );
    expect(events.map((event) => event.key)).toEqual(["message:m1", "message:m3"]);
  });
});

describe("the fake", () => {
  beforeEach(() => fakeWhatsApp.reset());

  it("sends once for one key, and can fail on demand", async () => {
    const input = { to: FROM, body: "Hi", clientRef: "k" };
    const first = await fakeGateway.sendText(input);
    const second = await fakeGateway.sendText(input);
    expect(second).toEqual(first);
    expect(fakeWhatsApp.sent).toHaveLength(1);
    fakeWhatsApp.failures.push(new GatewayError("rate_limited", true));
    await expect(fakeGateway.sendText({ ...input, clientRef: "z" })).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
  });
});
