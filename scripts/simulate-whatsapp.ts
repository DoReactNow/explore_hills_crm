// `npm run whatsapp:simulate -- <phone> <message> [name]`: pretends a customer messaged you, by
// posting a correctly signed webhook to your own running app. Fake gateway only; nothing leaves the
// machine.
import { randomUUID } from "node:crypto";
import { fakeInboundWebhook, signFake } from "../src/modules/messaging/gateway/fake";
import { normalisePhone } from "../src/modules/leads/leads.phone";
import { getEnv } from "../src/shared/config/env";
import { systemClock } from "../src/shared/time";

async function main(): Promise<void> {
  const env = getEnv();
  if (env.WHATSAPP_GATEWAY !== "fake" || env.APP_ENV === "production") {
    throw new Error('This only works with WHATSAPP_GATEWAY="fake", outside production.');
  }
  const [phone, text, name] = process.argv.slice(2);
  const e164 = phone ? normalisePhone(phone) : null;
  if (!e164 || !text)
    throw new Error('Usage: npm run whatsapp:simulate -- "+91 90000 00001" "Hello" "Riya"');
  const from = e164.replace(/^\+/, "");
  const raw = fakeInboundWebhook(
    [
      {
        id: `wamid.sim.${randomUUID()}`,
        from,
        timestamp: String(Math.floor(systemClock.now().getTime() / 1000)),
        type: "text",
        text: { body: text },
      },
    ],
    [{ wa_id: from, name }],
  );
  const response = await fetch(new URL("/api/webhooks/whatsapp", env.APP_URL), {
    method: "POST",
    headers: { "x-hub-signature-256": signFake(raw), "content-type": "application/json" },
    body: raw,
  });
  if (!response.ok) throw new Error(`The app answered ${response.status}. Is it running?`);
  console.log(`[simulate] delivered a message from ${e164}. The worker will process it.`);
}

main().catch((error: unknown) => {
  console.error(`[simulate] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
