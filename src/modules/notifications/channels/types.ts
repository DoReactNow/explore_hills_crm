// How a notification leaves the app. Each channel has a fake for development and tests, and production
// refuses the fakes (env.ts).
export class PermanentDeliveryError extends Error {}

export interface EmailSender {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  readonly publicKey: string | null;
  send(
    subscription: PushSubscriptionKeys,
    message: { title: string; body: string; link: string | null },
  ): Promise<void>;
}
