// The fake calling provider, for development and every test (Decision 24). It speaks a small webhook
// format of its own, signed like a real one. Production refuses it (env.ts).
import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { instantFromEpochMs } from "@/shared/time";
import type { CallStatus } from "../../telephony.types";
import { ProviderError, type CallEvent, type TelephonyProvider } from "../types";

export const FAKE_TELEPHONY_SECRET = "fake-telephony-secret-not-for-real-use";
const SIGNATURE_HEADER = "x-fake-signature";
const TOKEN_TTL_MS = 10 * 60 * 1000;

export const signFakeCall = (raw: string) =>
  createHmac("sha256", FAKE_TELEPHONY_SECRET).update(raw).digest("hex");

const STATUSES: Record<string, CallStatus> = {
  ringing: "RINGING_CUSTOMER",
  "agent-ringing": "RINGING_AGENT",
  answered: "ANSWERED",
  completed: "COMPLETED",
  "no-answer": "NO_ANSWER",
  busy: "BUSY",
  failed: "FAILED",
  rejected: "FAILED",
  canceled: "CANCELLED",
};

/** A second of silence as a WAV file, so recordings can run through the real conversion. */
export function fakeWav(seconds = 1): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(rate * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

interface FakeBehaviour {
  placeCallFails: boolean;
  recordings: Map<string, Buffer | "expired" | "unreachable">;
}
const behaviour: FakeBehaviour = { placeCallFails: false, recordings: new Map() };
export const fakeTelephony = {
  behaviour,
  reset() {
    behaviour.placeCallFails = false;
    behaviour.recordings.clear();
  },
};

export const fakeProvider: TelephonyProvider = {
  key: "fake",
  capabilities: {
    browserCalling: true,
    clickToCall: true,
    inboundRouting: true,
    recording: true,
    dualChannelRecording: false,
    liveStatusEvents: true,
  },

  async issueAgentCredentials({ userId, now }) {
    const expiresAt = instantFromEpochMs(now.getTime() + TOKEN_TTL_MS);
    const body = `${userId}.${expiresAt.getTime()}`;
    return { token: `${body}.${signFakeCall(body)}`, expiresAt };
  },

  async placeCall({ callRef }) {
    if (behaviour.placeCallFails) throw new ProviderError("the fake provider is unreachable");
    return `fake-${callRef}`;
  },

  verifyWebhook(rawBody, headers) {
    const given = headers.get(SIGNATURE_HEADER);
    if (!given) return false;
    const expected = Buffer.from(signFakeCall(rawBody));
    const actual = Buffer.from(given);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  },

  parseWebhook(body) {
    const events = (body as { events?: unknown })?.events;
    if (!Array.isArray(events)) return [];
    return events.flatMap((raw): CallEvent[] => {
      const event = raw as Record<string, unknown>;
      const providerCallId = typeof event.callId === "string" ? event.callId : null;
      if (!providerCallId || typeof event.id !== "string") return [];
      const callRef = typeof event.ref === "string" ? event.ref : null;
      const occurredAt = typeof event.at === "string" ? event.at : "";
      if (typeof event.recording === "string") {
        return [
          {
            kind: "recording",
            key: event.id,
            providerCallId,
            callRef,
            recordingRef: event.recording,
            occurredAt,
          },
        ];
      }
      const rawStatus = String(event.status ?? "");
      return [
        {
          kind: "status",
          key: event.id,
          providerCallId,
          callRef,
          status: STATUSES[rawStatus] ?? null,
          rawStatus,
          customerPhone: typeof event.phone === "string" ? event.phone : null,
          occurredAt,
          durationSeconds: typeof event.duration === "number" ? event.duration : null,
        },
      ];
    });
  },

  parseInboundRequest(body) {
    const request = body as { callId?: unknown; from?: unknown } | null;
    if (typeof request?.callId !== "string") return null;
    return {
      providerCallId: request.callId,
      customerPhone: typeof request.from === "string" ? request.from : null,
    };
  },

  answerInboundRouting(decision) {
    return Response.json(decision);
  },

  async fetchRecording(recordingRef) {
    const stored = behaviour.recordings.get(recordingRef);
    if (stored === "expired") throw new ProviderError("the recording link has expired", true);
    if (stored === "unreachable") throw new ProviderError("the fake provider is unreachable");
    return Readable.from([stored ?? fakeWav()]);
  },
};
