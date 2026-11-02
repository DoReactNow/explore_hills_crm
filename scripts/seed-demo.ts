// `npm run db:seed:demo`: invented data for looking around the app: 6 staff, 100 leads, chats, calls,
// follow-ups and notifications. Development database only. Running it again does nothing.
import { randomUUID } from "node:crypto";
import { createUserIfMissing } from "@/modules/identity";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { businessDateToDbDate, plusDuration, systemClock, toBusinessDate } from "@/shared/time";

const LEADS = 100;
const UNASSIGNED = 12;
const PASSWORD = "Hills-Test-4827!";
const DEMO_SOURCE_DETAIL = "Demo data";

const FIRST =
  "Asha Rohan Priya Vikram Neha Arjun Kavya Rahul Sneha Aditya Pooja Karan Meera Sahil Ananya Nikhil Divya Manish Ritu Sandeep Isha Gaurav Tanya Harsh Simran".split(
    " ",
  );
const LAST =
  "Sharma Mehta Verma Gupta Singh Kapoor Reddy Nair Joshi Iyer Malhotra Bansal Chopra Rao Thakur".split(
    " ",
  );
const PLACES = [
  "Manali",
  "Shimla",
  "Leh Ladakh",
  "Kasol",
  "Spiti Valley",
  "Nainital",
  "Mussoorie",
  "Rishikesh",
  "Darjeeling",
  "Munnar",
  "Coorg",
  "Ooty",
];
const SOURCES = ["WHATSAPP", "WHATSAPP", "WHATSAPP", "PHONE", "WEBSITE", "AD", "MANUAL"] as const;
const STAGES = [
  "CONTACTED",
  "CONTACTED",
  "CONTACTED",
  "QUALIFIED",
  "QUALIFIED",
  "QUOTED",
  "QUOTED",
  "WON",
  "LOST",
  "NEW",
];
const LOST = ["Price too high", "Chose another agency", "Trip postponed", "No response"];
const NOTES = [
  "Wants a hotel with a mountain view. Travelling with parents, so no long treks.",
  "Asked for a veg-only meal plan. Dates are flexible by two or three days.",
  "Comparing with one other agency. Said price matters more than hotel category.",
  "Honeymoon trip. Offered the private cab option and a candle-light dinner.",
  "Group of friends, wants a bonfire and an adventure day. Will confirm the numbers by Friday.",
  "Spoke to the husband; wife decides the final hotel. Call again in the evening.",
];
const TASKS = [
  "Send the updated quote",
  "Call back about dates",
  "Share hotel photos",
  "Confirm traveller count",
  "Follow up on the advance payment",
];
const CHAT = [
  ["IN", "Hi, I saw your {place} package. Can you share the details?"],
  [
    "OUT",
    "Hello {name}! Thanks for writing to Explore Hills. How many people are travelling, and when?",
  ],
  ["IN", "We are {people} people, planning around {month}."],
  ["OUT", "Lovely. For {place} I'd suggest 5 nights. Do you prefer a standard or a premium stay?"],
  ["IN", "Standard is fine, but the hotel should be clean and close to the market."],
  ["OUT", "Noted. I'll send you a quote within the hour, with two hotel options."],
  ["IN", "Thanks. Is breakfast included?"],
  ["OUT", "Yes, breakfast and dinner are both included in the quote."],
];
const OUTCOMES = ["INTERESTED", "CALL_BACK", "NO_ANSWER", "BUSY", "BOOKED", "NOT_INTERESTED"];

// The same data every time, so screenshots and notes stay comparable.
let state = 20261102;
const random = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

async function main() {
  const env = getEnv();
  if (env.APP_ENV !== "development" || !env.databaseName.endsWith("_dev")) {
    throw new Error(
      `Refusing: demo data is for the development database only (got "${env.databaseName}")`,
    );
  }
  const prisma = getPrisma();
  if ((await prisma.leadsLead.count({ where: { sourceDetail: DEMO_SOURCE_DETAIL } })) > 0) {
    console.log("[seed-demo] demo data is already there");
    return;
  }

  const staff = [
    ["demo.manager@example.com", "Meera Kapoor", "MANAGER"],
    ["demo.agent1@example.com", "Ravi Sharma", "AGENT"],
    ["demo.agent2@example.com", "Nisha Verma", "AGENT"],
    ["demo.agent3@example.com", "Imran Khan", "AGENT"],
    ["demo.agent4@example.com", "Lata Iyer", "AGENT"],
    ["demo.agent5@example.com", "Dev Malhotra", "AGENT"],
  ] as const;
  const ids: string[] = [];
  for (const [email, name, roleCode] of staff) {
    await createUserIfMissing({ email, name, password: PASSWORD, roleCode });
    ids.push((await prisma.identityUser.findUniqueOrThrow({ where: { email } })).id);
  }
  const [manager, ...agents] = ids;
  const team = await prisma.identityTeam.upsert({
    where: { name: "North India Sales" },
    update: {},
    create: { name: "North India Sales", managerUserId: manager },
  });
  await prisma.identityTeamMember.createMany({
    data: agents.map((userId) => ({ teamId: team.id, userId })),
    skipDuplicates: true,
  });
  await prisma.identityUser.updateMany({
    where: { id: { in: agents } },
    data: { managerId: manager },
  });

  const stages = new Map(
    (await prisma.leadsPipelineStage.findMany()).map((stage) => [stage.code, stage.id]),
  );
  const now = systemClock.now();
  const ago = (hours: number) => plusDuration(now, { hours: -hours });
  const day = (offset: number) =>
    businessDateToDbDate(toBusinessDate(plusDuration(now, { days: offset })));

  for (let n = 0; n < LEADS; n += 1) {
    const unassigned = n < UNASSIGNED;
    const first = pick(FIRST);
    const name = `${first} ${pick(LAST)}`;
    const place = pick(PLACES);
    const people = between(2, 8);
    const phone = `+9190000${String(10000 + n)}`;
    const source = pick(SOURCES);
    const stageCode = unassigned ? "NEW" : pick(STAGES);
    const owner = unassigned ? null : agents[n % agents.length];
    // Mostly recent: the waiting queue within hours, the rest spread over six weeks.
    const age = unassigned ? between(1, 30) * 0.25 : Math.floor(random() * random() * 1000) + 2;
    const createdAt = ago(age);
    const closed = stageCode === "WON" || stageCode === "LOST";
    const start = between(10, 90);

    const contact = await prisma.leadsContact.create({
      data: {
        phoneE164: phone,
        name,
        email: n % 3 === 0 ? `${first.toLowerCase()}${n}@example.com` : null,
        optInStatus: "OPTED_IN",
        optInAt: createdAt,
        optInSource: "Demo data",
      },
    });
    const lead = await prisma.leadsLead.create({
      data: {
        contactId: contact.id,
        source,
        sourceDetail: DEMO_SOURCE_DETAIL,
        stageId: stages.get(stageCode) as string,
        ownerUserId: owner,
        assignedAt: owner ? plusDuration(createdAt, { hours: 0.2 }) : null,
        destination: place,
        travelStartDate: day(start),
        travelEndDate: day(start + between(3, 7)),
        travellerCount: people,
        budgetAmount: between(4, 40) * 5000,
        firstResponseAt:
          owner && stageCode !== "NEW" ? plusDuration(createdAt, { hours: 0.3 + random() }) : null,
        lastActivityAt: ago(Math.min(age, between(1, 72))),
        closedAt: closed ? ago(Math.max(1, age / 2)) : null,
        lostReason: stageCode === "LOST" ? pick(LOST) : null,
        createdAt,
      },
    });
    const timeline = (
      kind: "LEAD_CREATED" | "ASSIGNED" | "STAGE_CHANGED" | "NOTE" | "MESSAGE" | "CALL",
      summary: string,
      occurredAt: Date,
    ) =>
      prisma.leadsTimelineEntry.create({
        data: { leadId: lead.id, kind, summary, refType: "demo", refId: randomUUID(), occurredAt },
      });
    await timeline("LEAD_CREATED", "Lead created", createdAt);

    if (owner) {
      await prisma.assignmentRecord.create({
        data: {
          leadId: lead.id,
          toUserId: owner,
          actorUserId: manager,
          mode: pick(["MANUAL", "ROUND_ROBIN", "LEAST_LOADED"] as const),
          createdAt: plusDuration(createdAt, { hours: 0.2 }),
        },
      });
      await timeline("ASSIGNED", "Assigned to an agent", plusDuration(createdAt, { hours: 0.2 }));
      if (stageCode !== "NEW")
        await timeline(
          "STAGE_CHANGED",
          `Stage changed to ${stageCode.toLowerCase()}`,
          plusDuration(createdAt, { hours: 1 }),
        );
      if (random() < 0.6) {
        const body = pick(NOTES);
        await prisma.leadsNote.create({
          data: {
            leadId: lead.id,
            authorUserId: owner,
            body,
            createdAt: plusDuration(createdAt, { hours: 1 }),
          },
        });
        await timeline("NOTE", body, plusDuration(createdAt, { hours: 1 }));
      }
      if (!closed && random() < 0.7) {
        const offset = between(-3, 7);
        await prisma.leadsTask.create({
          data: {
            leadId: lead.id,
            assigneeUserId: owner,
            title: pick(TASKS),
            dueDate: day(offset),
          },
        });
        await prisma.leadsLead.update({
          where: { id: lead.id },
          data: { nextFollowUpDate: day(offset) },
        });
      }
      if (random() < 0.5) {
        const startedAt = plusDuration(createdAt, { hours: 2 });
        const outcome = pick(OUTCOMES);
        const missed = outcome === "NO_ANSWER" || outcome === "BUSY";
        const seconds = between(45, 600);
        await prisma.telephonyCall.create({
          data: {
            providerKey: "fake",
            callRef: randomUUID(),
            direction: random() < 0.2 ? "INBOUND" : "OUTBOUND",
            status: missed ? "NO_ANSWER" : "COMPLETED",
            leadId: lead.id,
            agentUserId: owner,
            customerPhoneE164: phone,
            startedAt,
            answeredAt: missed ? null : startedAt,
            endedAt: plusDuration(startedAt, { hours: seconds / 3600 }),
            durationSeconds: missed ? 0 : seconds,
            billableSeconds: missed ? 0 : seconds,
            outcomeCode: outcome,
          },
        });
        await timeline("CALL", `Call: ${outcome.toLowerCase().replace("_", " ")}`, startedAt);
      }
    }

    if (source === "WHATSAPP" || random() < 0.4) {
      const count = unassigned ? 1 : between(2, CHAT.length);
      const last = ago(Math.min(age, between(1, 60)));
      const lines = CHAT.slice(0, count);
      const lastInbound = lines.filter(([side]) => side === "IN").length;
      const chat = await prisma.messagingConversation.create({
        data: {
          businessPhoneNumberId: "demo",
          waId: phone.slice(1),
          contactId: contact.id,
          leadId: lead.id,
          lastInboundAt: last,
          lastMessageAt: last,
          unreadCount:
            lines[lines.length - 1][0] === "IN" ? between(1, Math.max(1, lastInbound)) : 0,
        },
      });
      for (const [index, [side, text]] of lines.entries()) {
        const inbound = side === "IN";
        await prisma.messagingMessage.create({
          data: {
            conversationId: chat.id,
            direction: inbound ? "INBOUND" : "OUTBOUND",
            type: "TEXT",
            body: text
              .replace("{place}", place)
              .replace("{name}", first)
              .replace("{people}", String(people))
              .replace("{month}", "next month"),
            status: inbound ? "RECEIVED" : "READ",
            sentByUserId: inbound ? null : owner,
            occurredAt: plusDuration(last, { hours: (index - lines.length + 1) * 0.1 }),
          },
        });
      }
      await timeline("MESSAGE", "WhatsApp conversation", last);
    }

    if (owner && age < 72) {
      await prisma.notificationsNotification.create({
        data: {
          userId: owner,
          kind: "lead_assigned",
          title: "A lead was assigned to you",
          body: `${name} is asking about ${place}.`,
          link: `/leads/${lead.id}`,
          dedupeKeys: [`demo:${lead.id}`],
          createdAt,
        },
      });
    }
  }
  console.log(
    `[seed-demo] added ${LEADS} leads, ${UNASSIGNED} of them waiting in the queue, and ${staff.length} staff`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
