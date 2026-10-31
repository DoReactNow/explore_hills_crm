// The real channels. Thin on purpose: they only translate to the library and sort out which failures
// are worth retrying. They need the owner's mail account and keys, so tests use the fakes.
import nodemailer from "nodemailer";
import webpush from "web-push";
import { getEnv } from "@/shared/config/env";
import { PermanentDeliveryError, type EmailSender, type PushSender } from "./types";

const GONE = [404, 410];
const BAD_ADDRESS = 550;

export function createSmtpEmail(): EmailSender {
  const { SMTP_URL, EMAIL_FROM } = getEnv();
  const transport = nodemailer.createTransport(SMTP_URL as string);
  return {
    async send(message) {
      try {
        await transport.sendMail({ from: EMAIL_FROM, ...message });
      } catch (error) {
        if ((error as { responseCode?: number }).responseCode === BAD_ADDRESS) {
          throw new PermanentDeliveryError("the mail server refused this address");
        }
        throw error;
      }
    },
  };
}

export function createWebPush(): PushSender {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, APP_URL } = getEnv();
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC_KEY as string, VAPID_PRIVATE_KEY as string);
  return {
    publicKey: VAPID_PUBLIC_KEY as string,
    async send(subscription, message) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(message),
        );
      } catch (error) {
        if (GONE.includes((error as { statusCode?: number }).statusCode ?? 0)) {
          throw new PermanentDeliveryError("the subscription has expired");
        }
        throw error;
      }
    },
  };
}
