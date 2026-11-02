// Fills a throwaway database at the size the load test must prove (Decision 67): 30 people, 100,000
// leads, 1 million messages. Refuses any database whose name doesn't end in _load. All data is invented.
// Usage: DATABASE_URL=...explorehills_load npx tsx scripts/load/seed.ts
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { syncRbac } from "@/modules/identity";
import { ensureDefaultStages } from "@/modules/leads";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";

const LEADS = 100_000;
const CONVERSATIONS = 60_000;
const MESSAGES = 1_000_000;

async function main() {
  const env = getEnv();
  if (!env.databaseName.endsWith("_load")) {
    throw new Error(`Refusing: "${env.databaseName}" is not a _load database`);
  }
  const prisma = getPrisma();
  await syncRbac();
  await ensureDefaultStages();
  const run = (label: string, sql: string) => {
    console.log(`[seed] ${label}`);
    return prisma.$executeRawUnsafe(sql);
  };

  const people: Array<{ id: string; role: string; token: string }> = [];
  const roleId = async (code: string) =>
    (await prisma.identityRole.findUniqueOrThrow({ where: { code } })).id;
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const now = new Date();
  const addPerson = async (role: string, n: number, managerId?: string) => {
    const user = await prisma.identityUser.create({
      data: {
        email: `load.${role.toLowerCase()}.${n}@example.com`,
        name: `Load ${role} ${n}`,
        passwordHash: "not-a-real-hash",
        roleId: await roleId(role),
        status: "ACTIVE",
        managerId,
      },
    });
    const token = randomBytes(32).toString("base64url");
    await prisma.identitySession.create({
      data: {
        userId: user.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt,
        lastSeenAt: now,
        createdAt: now,
      },
    });
    people.push({ id: user.id, role, token });
    return user.id;
  };
  for (let n = 0; n < 2; n += 1) await addPerson("ADMIN", n);
  const managers = [];
  for (let n = 0; n < 3; n += 1) managers.push(await addPerson("MANAGER", n));
  for (let n = 0; n < 25; n += 1) await addPerson("AGENT", n, managers[n % managers.length]);
  writeFileSync("scripts/load/.sessions.json", JSON.stringify(people));

  await run(
    "contacts",
    `
    INSERT INTO leads_contacts (id, "phoneE164", name, "updatedAt")
    SELECT gen_random_uuid(), '+9190' || lpad(i::text, 8, '0'), 'Customer ' || i, now()
    FROM generate_series(1, ${LEADS}) i`,
  );
  await run(
    "leads",
    `
    WITH agents AS (
      SELECT array_agg(u.id) AS ids FROM identity_users u
      JOIN identity_roles r ON r.id = u."roleId" WHERE r.code = 'AGENT'
    ), stages AS (SELECT array_agg(id ORDER BY position) AS ids FROM leads_pipeline_stages),
    numbered AS (SELECT id, row_number() OVER () AS n FROM leads_contacts)
    INSERT INTO leads_leads (id, "contactId", "stageId", "ownerUserId", destination, "budgetAmount",
                             "createdAt", "updatedAt")
    SELECT gen_random_uuid(), c.id, s.ids[1 + (c.n % array_length(s.ids, 1))::int],
           CASE WHEN c.n % 50 = 0 THEN NULL ELSE a.ids[1 + (c.n % array_length(a.ids, 1))::int] END,
           (ARRAY['Manali','Shimla','Leh','Kasol','Spiti'])[1 + (c.n % 5)::int], 10000 + c.n % 90000,
           now() - ((c.n % 365) || ' days')::interval - ((c.n % 1440) || ' minutes')::interval, now()
    FROM numbered c, agents a, stages s`,
  );
  await run(
    "conversations",
    `
    INSERT INTO messaging_conversations
      (id, "businessPhoneNumberId", "waId", "contactId", "leadId", "lastInboundAt", "lastMessageAt", "unreadCount", "updatedAt")
    SELECT gen_random_uuid(), 'load', substr(c."phoneE164", 2), l."contactId", l.id,
           l."createdAt", l."createdAt" + interval '1 hour', 0, now()
    FROM leads_leads l JOIN leads_contacts c ON c.id = l."contactId"
    ORDER BY l.id LIMIT ${CONVERSATIONS}`,
  );
  await run(
    "messages",
    `
    WITH chats AS (
      SELECT id, "lastMessageAt", row_number() OVER () - 1 AS n FROM messaging_conversations
    )
    INSERT INTO messaging_messages (id, "conversationId", direction, type, body, status, "occurredAt")
    SELECT gen_random_uuid(), c.id,
           (CASE WHEN i % 2 = 0 THEN 'INBOUND' ELSE 'OUTBOUND' END)::"MessagingDirection", 'TEXT',
           'Message ' || i || ' about the trip dates and budget',
           (CASE WHEN i % 2 = 0 THEN 'RECEIVED' ELSE 'READ' END)::"MessagingMessageStatus",
           c."lastMessageAt" - (i % 1000 || ' minutes')::interval
    FROM generate_series(1, ${MESSAGES}) i
    JOIN chats c ON c.n = i % ${CONVERSATIONS}`,
  );
  await run(
    "timeline",
    `
    INSERT INTO leads_timeline_entries (id, "leadId", kind, summary, "occurredAt")
    SELECT gen_random_uuid(), l.id, 'LEAD_CREATED', 'Lead created', l."createdAt" FROM leads_leads l`,
  );
  await run(
    "notes",
    `
    INSERT INTO leads_notes (id, "leadId", "authorUserId", body, "createdAt")
    SELECT gen_random_uuid(), l.id, l."ownerUserId", 'Spoke to the customer about dates', l."createdAt"
    FROM leads_leads l WHERE l."ownerUserId" IS NOT NULL`,
  );
  await run(
    "follow-ups",
    `
    INSERT INTO leads_tasks (id, "leadId", "assigneeUserId", title, "dueDate", "updatedAt")
    SELECT gen_random_uuid(), l.id, l."ownerUserId", 'Call back',
           (now() + ((row_number() OVER () % 60) - 30 || ' days')::interval)::date, now()
    FROM leads_leads l WHERE l."ownerUserId" IS NOT NULL LIMIT 50000`,
  );
  await run(
    "calls",
    `
    INSERT INTO telephony_calls (id, "providerKey", "callRef", status, "customerPhoneE164", "agentUserId", "leadId", "startedAt", "updatedAt")
    SELECT gen_random_uuid(), 'fake', gen_random_uuid()::text, 'COMPLETED', c."phoneE164", l."ownerUserId", l.id, l."createdAt", now()
    FROM leads_leads l JOIN leads_contacts c ON c.id = l."contactId"
    WHERE l."ownerUserId" IS NOT NULL LIMIT 50000`,
  );
  await run(
    "assignments",
    `
    INSERT INTO assignment_records (id, "leadId", "toUserId", mode, "createdAt")
    SELECT gen_random_uuid(), l.id, l."ownerUserId", 'MANUAL', l."createdAt"
    FROM leads_leads l WHERE l."ownerUserId" IS NOT NULL`,
  );
  await run(
    "notifications",
    `
    INSERT INTO notifications_notifications (id, "userId", kind, title, body, "createdAt", "updatedAt")
    SELECT gen_random_uuid(), l."ownerUserId", 'lead_assigned', 'A lead was assigned to you', 'Customer', l."createdAt", now()
    FROM leads_leads l WHERE l."ownerUserId" IS NOT NULL`,
  );
  await run(
    "audit",
    `
    INSERT INTO audit_events ("occurredAt", "entityType", "entityId", summary, action, id)
    SELECT l."createdAt", 'lead', l.id::text, 'Lead created', 'lead.created', gen_random_uuid()
    FROM leads_leads l`,
  );
  await prisma.$executeRawUnsafe("ANALYZE");
  console.log("[seed] done");
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
