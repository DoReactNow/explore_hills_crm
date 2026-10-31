// The fake softphone: no audio, and it asks the app to play the provider's part. A test or a developer
// can steer it with sessionStorage keys: fakeCallResult (answered, busy, no-answer, stay) and fakeMic
// (denied, none). Production refuses the fake provider.
import { apiRequest } from "@/shared/api/client";
import type { SoftphoneFactory } from "../softphone";

const ANSWER_DELAY_MS = 600;
const read = (key: string) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const report = (body: Record<string, unknown>) =>
  apiRequest("/api/telephony/fake", { method: "POST", body });

export const createFakeSoftphone: SoftphoneFactory = (events) => {
  let current: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let connected = false;
  return {
    async connect() {
      const mic = read("fakeMic");
      if (mic === "denied") events.error("mic_denied");
      if (mic === "none") events.error("no_mic");
    },
    async dial(callRef) {
      current = callRef;
      connected = false;
      await report({ callRef, status: "ringing" });
      events.ringing();
      const result = read("fakeCallResult") ?? "answered";
      if (result === "stay") return;
      timer = setTimeout(async () => {
        if (result === "answered") {
          connected = true;
          await report({ callRef, status: "answered" });
          events.connected();
        } else {
          current = null;
          await report({ callRef, status: result });
          events.ended();
        }
      }, ANSWER_DELAY_MS);
    },
    async answer() {
      connected = true;
      events.connected();
    },
    async hangup() {
      clearTimeout(timer);
      const callRef = current;
      current = null;
      if (callRef && connected) {
        await report({ callRef, status: "completed" });
        await report({ callRef, recording: `fake-${callRef}` });
      }
      connected = false;
      events.ended();
    },
    async mute() {},
    async hold() {},
    async sendDtmf() {},
    disconnect() {
      clearTimeout(timer);
    },
  };
};
