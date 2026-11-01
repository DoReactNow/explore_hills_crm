// The public privacy notice (P10-ERASE-12). Anyone can read it without signing in. The wording is a
// setting, so it can change without a release; company and contact details come from APP_CONFIG only.
import type { Metadata } from "next";
import { connection } from "next/server";
import { getSetting } from "@/modules/system";
import { APP_CONFIG } from "@/shared/config/appConfig";
import styles from "./notice.module.css";

export const metadata: Metadata = { title: `Privacy notice · ${APP_CONFIG.company.legalName}` };

export default async function Page() {
  await connection();
  const [text, messageDays, recordingDays] = await Promise.all([
    getSetting("privacy.noticeText"),
    getSetting("retention.messageDays"),
    getSetting("retention.recordingDays"),
  ]);
  const values: Record<string, string> = {
    company: APP_CONFIG.company.legalName,
    email: APP_CONFIG.support.email,
    phone: APP_CONFIG.support.phoneDisplay,
    messageDays: String(messageDays),
    recordingDays: String(recordingDays),
  };
  const filled = (text as string).replace(
    /\{(\w+)\}/g,
    (match, key: string) => values[key] ?? match,
  );
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Privacy notice</h1>
      {filled
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index} className={styles.text}>
            {paragraph}
          </p>
        ))}
    </main>
  );
}
