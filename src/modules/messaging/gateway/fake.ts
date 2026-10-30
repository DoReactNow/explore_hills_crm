// The fake gateway for development and tests (refused in production). It speaks Meta's webhook
// format and signature, so everything above it runs as it will for real. Nothing leaves the machine.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { parseMetaWebhook } from "./metaFormat";
import { GatewayError, type SendResult, type WhatsAppGateway } from "./types";

export const FAKE_APP_SECRET = "fake-whatsapp-app-secret-not-for-real-use";
export const FAKE_VERIFY_TOKEN = "fake-whatsapp-verify-token";
export const FAKE_BUSINESS_PHONE_ID = "fake-business-phone-id";
export const FAKE_BUSINESS_NUMBER = "919000099999";

export interface FakeSent {
  kind: "text" | "template" | "media";
  to: string;
  clientRef: string;
  providerMessageId: string;
  body?: string;
  name?: string;
  variables?: readonly string[];
  filename?: string;
}

// One PNG pixel: a real image, so a downloaded fake file opens.
const SMALL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64",
);

export const fakeWhatsApp = {
  sent: [] as FakeSent[],
  /** Errors the next sends will throw, in order. */
  failures: [] as GatewayError[],
  templateStatus: "APPROVED",
  reset() {
    this.sent.length = 0;
    this.failures.length = 0;
    this.templateStatus = "APPROVED";
  },
};

export function signFake(rawBody: string): string {
  return `sha256=${createHmac("sha256", FAKE_APP_SECRET).update(rawBody).digest("hex")}`;
}

function record(entry: Omit<FakeSent, "providerMessageId">): SendResult {
  const failure = fakeWhatsApp.failures.shift();
  if (failure) throw failure;
  // The same key twice sends once.
  const existing = fakeWhatsApp.sent.find((item) => item.clientRef === entry.clientRef);
  if (existing) return { providerMessageId: existing.providerMessageId };
  const providerMessageId = `wamid.fake.${randomUUID()}`;
  fakeWhatsApp.sent.push({ ...entry, providerMessageId });
  return { providerMessageId };
}

export const fakeGateway: WhatsAppGateway = {
  key: "fake",
  businessPhoneNumberId: FAKE_BUSINESS_PHONE_ID,

  verifySignature(rawBody, headers) {
    const given = Buffer.from(headers.get("x-hub-signature-256") ?? "");
    const expected = Buffer.from(signFake(rawBody));
    return given.length === expected.length && timingSafeEqual(given, expected);
  },

  verifyHandshake: (token) => token === FAKE_VERIFY_TOKEN,

  parseWebhook: parseMetaWebhook,

  sendText: async ({ to, body, clientRef }) => record({ kind: "text", to, body, clientRef }),

  sendTemplate: async ({ to, name, variables, clientRef }) =>
    record({ kind: "template", to, name, variables, clientRef }),

  sendMedia: async ({ to, filename, clientRef, caption }) =>
    record({ kind: "media", to, filename, clientRef, body: caption ?? undefined }),

  async downloadMedia(mediaId) {
    if (mediaId.startsWith("expired")) throw new GatewayError("media_expired", true);
    if (mediaId.startsWith("huge")) {
      return { bytes: new Uint8Array(26 * 1024 * 1024), mimeType: "image/png" };
    }
    return { bytes: new Uint8Array(SMALL_PNG), mimeType: "image/png" };
  },

  submitTemplate: async () => ({
    status: fakeWhatsApp.templateStatus,
    providerRef: `fake-${randomUUID()}`,
  }),
};

/** A webhook body in Meta's format, for tests and the local simulator. */
export function fakeInboundWebhook(
  messages: Array<Record<string, unknown>>,
  contacts: Array<{ wa_id: string; name?: string }> = [],
): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                display_phone_number: FAKE_BUSINESS_NUMBER,
                phone_number_id: FAKE_BUSINESS_PHONE_ID,
              },
              contacts: contacts.map(({ wa_id, name }) => ({
                wa_id,
                ...(name ? { profile: { name } } : {}),
              })),
              messages,
            },
          },
        ],
      },
    ],
  });
}

export function fakeStatusWebhook(statuses: Array<Record<string, unknown>>): string {
  return JSON.stringify({ entry: [{ changes: [{ value: { statuses } }] }] });
}
