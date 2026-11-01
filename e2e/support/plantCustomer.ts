import { Client } from "pg";

/** Puts the text in everything a person types or a customer sends, on a lead owned by this person. */
export async function plantCustomer(ownerEmail: string, text: string): Promise<string> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const phone = `+9198${String(Math.floor(10000000 + Math.random() * 89999999))}`;
    const owner = await client.query(`SELECT id FROM identity_users WHERE email = $1`, [
      ownerEmail,
    ]);
    const ownerId = owner.rows[0].id as string;
    const stage = await client.query(`SELECT id FROM leads_pipeline_stages WHERE code = 'NEW'`);
    const contact = await client.query(
      `INSERT INTO leads_contacts (id, "phoneE164", name, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id`,
      [phone, text],
    );
    const lead = await client.query(
      `INSERT INTO leads_leads (id, "contactId", "stageId", "ownerUserId", destination, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now()) RETURNING id`,
      [contact.rows[0].id, stage.rows[0].id, ownerId, text],
    );
    const leadId = lead.rows[0].id as string;
    await client.query(
      `INSERT INTO leads_notes (id, "leadId", "authorUserId", body, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, now())`,
      [leadId, ownerId, text],
    );
    await client.query(
      `INSERT INTO leads_tasks (id, "leadId", "assigneeUserId", title, "dueDate", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, now(), now())`,
      [leadId, ownerId, text],
    );
    const chat = await client.query(
      `INSERT INTO messaging_conversations
         (id, "businessPhoneNumberId", "waId", "contactId", "leadId", "lastMessageAt", "updatedAt")
       VALUES (gen_random_uuid(), 'xss', $1, $2, $3, now(), now()) RETURNING id`,
      [phone.slice(1), contact.rows[0].id, leadId],
    );
    await client.query(
      `INSERT INTO messaging_messages
         (id, "conversationId", direction, type, body, status, "occurredAt")
       VALUES (gen_random_uuid(), $1, 'INBOUND', 'TEXT', $2, 'RECEIVED', now())`,
      [chat.rows[0].id, text],
    );
    await client.query(
      `INSERT INTO notifications_notifications
         (id, "userId", kind, title, body, link, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'lead_assigned', $2, $2, $3, now(), now())`,
      [ownerId, text, `/leads/${leadId}`],
    );
    return leadId;
  } finally {
    await client.end();
  }
}

/** Takes planted customers out of every list, so later specs see only their own data. */
export async function removePlanted(leadIds: readonly string[]): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`UPDATE leads_leads SET "deletedAt" = now() WHERE id = ANY($1::uuid[])`, [
      leadIds,
    ]);
    await client.query(`DELETE FROM notifications_notifications WHERE link = ANY($1::text[])`, [
      leadIds.map((id) => `/leads/${id}`),
    ]);
  } finally {
    await client.end();
  }
}
