// Delivers a signed fake WhatsApp webhook to the app under test.
import { createHmac, randomUUID } from "node:crypto";

const FAKE_APP_SECRET = "fake-whatsapp-app-secret-not-for-real-use";

export async function customerSends(
  baseURL: string,
  from: string,
  text: string,
  name?: string,
  ageHours = 0,
) {
  const timestamp = String(Math.floor(Date.now() / 1000) - ageHours * 3600);
  const raw = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                display_phone_number: "919000099999",
                phone_number_id: "fake-business-phone-id",
              },
              contacts: [{ wa_id: from, ...(name ? { profile: { name } } : {}) }],
              messages: [
                {
                  id: `wamid.e2e.${randomUUID()}`,
                  from,
                  timestamp,
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac("sha256", FAKE_APP_SECRET).update(raw).digest("hex")}`;
  const response = await fetch(new URL("/api/webhooks/whatsapp", baseURL), {
    method: "POST",
    headers: { "x-hub-signature-256": signature },
    body: raw,
  });
  if (!response.ok) throw new Error(`webhook answered ${response.status}`);
}
