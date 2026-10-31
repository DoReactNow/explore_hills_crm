// Stored provider logins are encrypted with the key from the environment (Decision 24).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/shared/config/env";

const key = () => Buffer.from(getEnv().CREDENTIALS_ENCRYPTION_KEY, "base64");

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
}

export function decryptSecret(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
