// dist/send-test-email.js in production: proves the mail settings work, through the app's real channel.
// Usage: node dist/send-test-email.js person@example.com
import { getEmailSender } from "@/modules/notifications/channels/registry";

const to = process.argv[2];
if (!to) throw new Error("Give the address to send to");

getEmailSender()
  .send({
    to,
    subject: "Explore Hills CRM: test email",
    text: "The CRM can send email. Nothing else needs doing.",
  })
  .then(() => console.log(`[send-test-email] the mail server accepted it for ${to}`))
  .catch((error: unknown) => {
    console.error(`[send-test-email] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
