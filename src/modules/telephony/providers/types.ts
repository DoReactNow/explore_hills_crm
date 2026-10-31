// The server side of a calling provider (Decision 24). Every adapter maps its own statuses onto ours,
// so nothing outside its folder knows which provider is in use.
import type { Readable } from "node:stream";
import type { CallStatus, Capabilities } from "../telephony.types";

export interface AgentCredentials {
  token: string;
  expiresAt: Date;
}

export type CallEvent =
  | {
      kind: "status";
      key: string;
      providerCallId: string;
      callRef: string | null;
      /** Null for a status the adapter doesn't know: it is logged, and never moves the call. */
      status: CallStatus | null;
      rawStatus: string;
      customerPhone: string | null;
      occurredAt: string;
      durationSeconds: number | null;
    }
  | {
      kind: "recording";
      key: string;
      providerCallId: string;
      callRef: string | null;
      recordingRef: string;
      occurredAt: string;
    };

export interface InboundRequest {
  providerCallId: string;
  /** Null when the number is hidden or unusable. */
  customerPhone: string | null;
}

export type InboundDecision =
  | { action: "ring"; agentUserId: string; callRef: string; announcement: string }
  | { action: "voicemail"; callRef: string | null; prompt: string };

export class ProviderError extends Error {
  constructor(
    message: string,
    /** The recording link has gone for good, so trying again can't help. */
    readonly permanent = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface TelephonyProvider {
  readonly key: string;
  readonly capabilities: Capabilities;
  issueAgentCredentials(agent: { userId: string; now: Date }): Promise<AgentCredentials>;
  /** Click-to-call: rings the agent's phone, then the customer. Returns the provider's call ID. */
  placeCall(request: {
    callRef: string;
    agentPhone: string;
    customerPhone: string;
  }): Promise<string>;
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(body: unknown): CallEvent[];
  parseInboundRequest(body: unknown): InboundRequest | null;
  /** The answer the provider expects to an inbound routing request. */
  answerInboundRouting(decision: InboundDecision): Response;
  fetchRecording(recordingRef: string): Promise<Readable>;
}
