// Remembers what it was asked to send, and can be told to fail.
import { PermanentDeliveryError, type EmailSender, type PushSender } from "./types";

const emails: Array<{ to: string; subject: string; text: string }> = [];
const pushes: Array<{ endpoint: string; title: string; body: string }> = [];
const failures = {
  emailTo: new Set<string>(),
  emailOutage: false,
  expiredEndpoints: new Set<string>(),
};

export const fakeChannels = {
  emails,
  pushes,
  failures,
  reset() {
    emails.length = 0;
    pushes.length = 0;
    failures.emailTo.clear();
    failures.emailOutage = false;
    failures.expiredEndpoints.clear();
  },
};

export const fakeEmail: EmailSender = {
  async send(message) {
    if (failures.emailOutage) throw new Error("the fake mail server is down");
    if (failures.emailTo.has(message.to)) throw new PermanentDeliveryError("no such mailbox");
    emails.push(message);
  },
};

export const fakePush: PushSender = {
  publicKey: "fake-public-key",
  async send(subscription, message) {
    if (failures.expiredEndpoints.has(subscription.endpoint)) {
      throw new PermanentDeliveryError("the subscription has expired");
    }
    pushes.push({ endpoint: subscription.endpoint, title: message.title, body: message.body });
  },
};
