import { signFakeCall, fakeProvider } from "../providers/fake/server";
import { runProviderContract } from "./providerContract";

const status = (value: string) => ({
  events: [
    { id: `e-${value}`, callId: "c1", ref: "r1", status: value, at: "2026-11-02T06:00:00Z" },
  ],
});

runProviderContract(fakeProvider, {
  sign: (raw) => new Headers({ "x-fake-signature": signFakeCall(raw) }),
  statuses: [
    { body: status("ringing"), expected: "RINGING_CUSTOMER" },
    { body: status("agent-ringing"), expected: "RINGING_AGENT" },
    { body: status("answered"), expected: "ANSWERED" },
    { body: status("completed"), expected: "COMPLETED" },
    { body: status("no-answer"), expected: "NO_ANSWER" },
    { body: status("busy"), expected: "BUSY" },
    { body: status("failed"), expected: "FAILED" },
    { body: status("rejected"), expected: "FAILED" },
    { body: status("canceled"), expected: "CANCELLED" },
  ],
  unknownStatus: status("on-the-moon"),
  recordingReady: { events: [{ id: "e-r", callId: "c1", ref: "r1", recording: "rec-1", at: "x" }] },
  junk: [null, {}, { events: "no" }, { events: [{}] }],
  inbound: { body: { callId: "c9", from: "+919800000000" }, phone: "+919800000000" },
});
