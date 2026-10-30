// The WhatsApp gateway (Decision 19): everything the app needs from Meta or a reseller. The rest of
// the app knows only this, so changing route needs a new adapter and nothing else.

export type InboundType =
  "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO" | "INTERACTIVE" | "UNSUPPORTED";

export interface InboundMessageEvent {
  kind: "message";
  key: string;
  waMessageId: string;
  phoneNumberId: string;
  from: string;
  profileName: string | null;
  type: InboundType;
  body: string | null;
  mediaId: string | null;
  mimeType: string | null;
  filename: string | null;
  replyToWaId: string | null;
  occurredAt: string;
  /** From the business number itself, or a group: never becomes a lead. */
  ignorable: boolean;
}

export interface StatusEvent {
  kind: "status";
  key: string;
  waMessageId: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  occurredAt: string;
  errorCode: string | null;
}

export interface TemplateStatusEvent {
  kind: "template";
  key: string;
  name: string;
  language: string;
  status: string;
  reason: string | null;
}

export type GatewayEvent = InboundMessageEvent | StatusEvent | TemplateStatusEvent;

/** A provider failure. Retryable ones (outage, rate limit) try again; others fail the message. */
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`WhatsApp gateway error: ${code}`);
    this.name = "GatewayError";
  }
}

export interface SendResult {
  providerMessageId: string;
}

export interface WhatsAppGateway {
  readonly key: string;
  readonly businessPhoneNumberId: string;
  /** Checks the signature against the body exactly as received. */
  verifySignature(rawBody: string, headers: Headers): boolean;
  verifyHandshake(token: string | null): boolean;
  /** Never throws: anything it can't read is left out. */
  parseWebhook(body: unknown): GatewayEvent[];
  sendText(input: { to: string; body: string; clientRef: string }): Promise<SendResult>;
  sendTemplate(input: {
    to: string;
    name: string;
    language: string;
    variables: readonly string[];
    clientRef: string;
  }): Promise<SendResult>;
  sendMedia(input: {
    to: string;
    bytes: Uint8Array;
    mimeType: string;
    filename: string;
    caption: string | null;
    clientRef: string;
  }): Promise<SendResult>;
  downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  submitTemplate(input: {
    name: string;
    language: string;
    category: string;
    body: string;
  }): Promise<{ status: string; providerRef: string | null }>;
}
