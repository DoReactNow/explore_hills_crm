// Picks the channels named by EMAIL_DRIVER and PUSH_DRIVER.
import { getEnv } from "@/shared/config/env";
import { fakeEmail, fakePush } from "./fake";
import { createSmtpEmail, createWebPush } from "./real";
import type { EmailSender, PushSender } from "./types";

let email: EmailSender | undefined;
let push: PushSender | undefined;

export function getEmailSender(): EmailSender {
  email ??= getEnv().EMAIL_DRIVER === "smtp" ? createSmtpEmail() : fakeEmail;
  return email;
}

export function getPushSender(): PushSender {
  push ??= getEnv().PUSH_DRIVER === "webpush" ? createWebPush() : fakePush;
  return push;
}
