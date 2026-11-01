// Prisma access to the telephony module's tables. No business rules here.
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";
import { ENDED_STATUSES } from "./telephony.types";

export type Tx = Prisma.TransactionClient;

const ACTIVE = { status: { notIn: [...ENDED_STATUSES] } };

export const CALL_SELECT = {
  id: true,
  callRef: true,
  direction: true,
  channel: true,
  status: true,
  leadId: true,
  agentUserId: true,
  customerPhoneE164: true,
  startedAt: true,
  answeredAt: true,
  endedAt: true,
  durationSeconds: true,
  outcomeCode: true,
  outcomeNotes: true,
  agent: { select: { id: true, name: true } },
  lead: { select: { id: true, destination: true, contact: { select: { name: true } } } },
  recording: { select: { status: true, expiresAt: true } },
} satisfies Prisma.TelephonyCallSelect;

export type CallRow = Prisma.TelephonyCallGetPayload<{ select: typeof CALL_SELECT }>;

export const telephonyRepository = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work);
  },

  async lock(tx: Tx, keys: readonly string[]): Promise<void> {
    for (const key of [...new Set(keys)].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telephony:${key}`}, 0))`;
    }
  },

  findCallByRef: (tx: Tx, callRef: string) => tx.telephonyCall.findUnique({ where: { callRef } }),

  findCallById: (tx: Tx, id: string) => tx.telephonyCall.findUnique({ where: { id } }),

  findCallByProviderId: (tx: Tx, providerKey: string, providerCallId: string) =>
    tx.telephonyCall.findUnique({
      where: { providerKey_providerCallId: { providerKey, providerCallId } },
    }),

  /** A call not yet told its provider ID, for an event that only gives the phone number. */
  findUnmatchedCallByPhone: (tx: Tx, phone: string) =>
    tx.telephonyCall.findFirst({
      where: { customerPhoneE164: phone, providerCallId: null, ...ACTIVE },
      orderBy: { startedAt: "desc" },
    }),

  findActiveForAgent: (tx: Tx, agentUserId: string) =>
    tx.telephonyCall.findFirst({ where: { agentUserId, ...ACTIVE } }),

  findActiveForPhone: (tx: Tx, phone: string) =>
    tx.telephonyCall.findFirst({ where: { customerPhoneE164: phone, ...ACTIVE } }),

  createCall: (tx: Tx, data: Prisma.TelephonyCallUncheckedCreateInput) =>
    tx.telephonyCall.create({ data }),

  updateCall: (tx: Tx, id: string, data: Prisma.TelephonyCallUncheckedUpdateInput) =>
    tx.telephonyCall.update({ where: { id }, data }),

  /** Only one person can answer: the status changes for the first caller alone. */
  async markAnswered(tx: Tx, id: string, userId: string, at: Date): Promise<boolean> {
    const { count } = await tx.telephonyCall.updateMany({
      where: {
        id,
        status: "RINGING_AGENT",
        answeredAt: null,
        OR: [{ agentUserId: userId }, { agentUserId: null }],
      },
      data: { status: "ANSWERED", answeredAt: at, agentUserId: userId },
    });
    return count === 1;
  },

  /** Sets the outcome once. False means someone already did. */
  async setOutcome(tx: Tx, id: string, code: string, notes: string | null): Promise<boolean> {
    const { count } = await tx.telephonyCall.updateMany({
      where: { id, outcomeCode: null },
      data: { outcomeCode: code, outcomeNotes: notes },
    });
    return count === 1;
  },

  getCall: (id: string) =>
    getPrisma().telephonyCall.findUnique({ where: { id }, select: CALL_SELECT }),

  listForLead: (leadId: string) =>
    getPrisma().telephonyCall.findMany({
      where: { leadId },
      orderBy: { startedAt: "desc" },
      take: 100,
      select: CALL_SELECT,
    }),

  listCalls(where: Prisma.TelephonyCallWhereInput, skip: number, take: number) {
    const prisma = getPrisma();
    return Promise.all([
      prisma.telephonyCall.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip,
        take,
        select: CALL_SELECT,
      }),
      prisma.telephonyCall.count({ where }),
    ]);
  },

  myCurrentCall: (agentUserId: string) =>
    getPrisma().telephonyCall.findFirst({
      where: { agentUserId, ...ACTIVE },
      orderBy: { startedAt: "desc" },
      select: CALL_SELECT,
    }),

  staleCalls: (ringingBefore: Date, answeredBefore: Date) =>
    getPrisma().telephonyCall.findMany({
      where: {
        OR: [
          {
            status: { in: ["INITIATED", "RINGING_AGENT", "RINGING_CUSTOMER"] },
            startedAt: { lt: ringingBefore },
          },
          { status: "ANSWERED", startedAt: { lt: answeredBefore } },
        ],
      },
      select: { id: true },
      take: 500,
    }),

  // Webhook events

  async storeEvent(providerKey: string, eventKey: string, payload: Prisma.InputJsonValue) {
    await getPrisma().telephonyWebhookEvent.createMany({
      data: [{ providerKey, eventKey, payload }],
      skipDuplicates: true,
    });
    return getPrisma().telephonyWebhookEvent.findUniqueOrThrow({
      where: { providerKey_eventKey: { providerKey, eventKey } },
    });
  },

  findEvent: (tx: Tx, id: string) => tx.telephonyWebhookEvent.findUnique({ where: { id } }),

  async markEventDone(tx: Tx, id: string, at: Date, error: string | null) {
    await tx.telephonyWebhookEvent.update({ where: { id }, data: { processedAt: at, error } });
  },

  // Recordings

  async noteRecordingReady(tx: Tx, callId: string, ref: string, at: Date) {
    await tx.telephonyRecording.upsert({
      where: { callId },
      create: { callId, providerRecordingRef: ref, readyAt: at },
      update: {},
    });
  },

  findRecording: (callId: string) =>
    getPrisma().telephonyRecording.findUnique({ where: { callId } }),

  async updateRecording(callId: string, data: Prisma.TelephonyRecordingUncheckedUpdateInput) {
    await getPrisma().telephonyRecording.update({ where: { callId }, data });
  },

  /** Takes the work: false if it's already stored or another run holds it. */
  async claimRecording(callId: string, heldBefore: Date): Promise<boolean> {
    const { count } = await getPrisma().telephonyRecording.updateMany({
      where: {
        callId,
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "DOWNLOADING", updatedAt: { lt: heldBefore } },
        ],
      },
      data: { status: "DOWNLOADING", attempts: { increment: 1 } },
    });
    return count === 1;
  },

  /** Saves how a download ended, unless the recording was erased or deleted meanwhile. */
  async finishRecording(
    callId: string,
    data: Prisma.TelephonyRecordingUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const { count } = await getPrisma().telephonyRecording.updateMany({
      where: { callId, status: "DOWNLOADING" },
      data,
    });
    return count === 1;
  },

  /** Recordings past their date. A customer on hold keeps theirs (Decision 66). */
  expiredRecordings: (now: Date, take: number) =>
    getPrisma().telephonyRecording.findMany({
      where: {
        status: "STORED",
        expiresAt: { lte: now },
        call: { OR: [{ leadId: null }, { lead: { contact: { legalHoldAt: null } } }] },
      },
      take,
      select: { callId: true, storageKey: true },
    }),

  async markRecordingsDeleted(tx: Tx, callIds: readonly string[], at: Date): Promise<void> {
    await tx.telephonyRecording.updateMany({
      where: { callId: { in: [...callIds] } },
      data: { status: "DELETED", storageKey: null, deletedAt: at },
    });
  },

  async refuseRecording(tx: Tx, callId: string, at: Date): Promise<void> {
    await tx.telephonyRecording.upsert({
      where: { callId },
      create: { callId, status: "DELETED", readyAt: at, deletedAt: at },
      update: {},
    });
  },

  // Privacy

  hasActiveCall: async (tx: Tx, phone: string, leadIds: readonly string[]) =>
    (await tx.telephonyCall.count({
      where: { ...ACTIVE, OR: [{ customerPhoneE164: phone }, { leadId: { in: [...leadIds] } }] },
    })) > 0,

  /** The number goes from every call, and the recordings with it. The log of calls stays. */
  async eraseCalls(tx: Tx, phone: string, leadIds: readonly string[], at: Date): Promise<string[]> {
    const where = { OR: [{ customerPhoneE164: phone }, { leadId: { in: [...leadIds] } }] };
    const calls = await tx.telephonyCall.findMany({
      where,
      select: { id: true, recording: { select: { storageKey: true } } },
    });
    const callIds = calls.map((call) => call.id);
    await tx.telephonyCall.updateMany({
      where: { id: { in: callIds } },
      data: { customerPhoneE164: "hidden", outcomeNotes: null, routingNote: null },
    });
    await tx.telephonyRecording.updateMany({
      where: { callId: { in: callIds } },
      data: {
        status: "DELETED",
        storageKey: null,
        providerRecordingRef: null,
        lastError: null,
        deletedAt: at,
      },
    });
    return calls.flatMap((call) => (call.recording?.storageKey ? [call.recording.storageKey] : []));
  },

  async eraseWebhookEvents(tx: Tx, phoneDigits: string): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM telephony_webhook_events WHERE payload::text LIKE ${`%${phoneDigits}%`}`;
  },

  exportCalls: (phone: string, leadIds: readonly string[]) =>
    getPrisma().telephonyCall.findMany({
      where: { OR: [{ customerPhoneE164: phone }, { leadId: { in: [...leadIds] } }] },
      orderBy: { startedAt: "asc" },
      select: {
        startedAt: true,
        endedAt: true,
        direction: true,
        status: true,
        durationSeconds: true,
        outcomeCode: true,
        outcomeNotes: true,
        recording: { select: { status: true, expiresAt: true } },
      },
    }),

  async deleteOldWebhookEvents(before: Date, take: number): Promise<number> {
    const rows = await getPrisma().telephonyWebhookEvent.findMany({
      where: { receivedAt: { lt: before } },
      take,
      select: { id: true },
    });
    const { count } = await getPrisma().telephonyWebhookEvent.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return count;
  },

  // Endpoints

  async touchPresence(providerKey: string, userId: string, at: Date) {
    await getPrisma().telephonyAgentEndpoint.upsert({
      where: { providerKey_userId: { providerKey, userId } },
      create: { providerKey, userId, lastSeenAt: at },
      update: { lastSeenAt: at },
    });
  },

  async clearPresence(providerKey: string, userId: string) {
    await getPrisma().telephonyAgentEndpoint.updateMany({
      where: { providerKey, userId },
      data: { lastSeenAt: null },
    });
  },

  async onlineSince(providerKey: string, since: Date): Promise<string[]> {
    const rows = await getPrisma().telephonyAgentEndpoint.findMany({
      where: { providerKey, isActive: true, lastSeenAt: { gte: since } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  },

  async agentsOnCalls(userIds: readonly string[]): Promise<Set<string>> {
    const rows = await getPrisma().telephonyCall.findMany({
      where: { agentUserId: { in: [...userIds] }, ...ACTIVE },
      select: { agentUserId: true },
    });
    return new Set(rows.flatMap((row) => row.agentUserId ?? []));
  },

  async lastCallAt(userIds: readonly string[]) {
    const rows = await getPrisma().telephonyCall.groupBy({
      by: ["agentUserId"],
      where: { agentUserId: { in: [...userIds] } },
      _max: { startedAt: true },
    });
    return new Map(rows.map((row) => [row.agentUserId as string, row._max.startedAt]));
  },

  async saveEndpoint(
    tx: Tx,
    providerKey: string,
    userId: string,
    data: { loginEncrypted: string; secretEncrypted: string | null },
  ) {
    await tx.telephonyAgentEndpoint.upsert({
      where: { providerKey_userId: { providerKey, userId } },
      create: { providerKey, userId, ...data },
      update: data,
    });
  },

  findEndpoint: (providerKey: string, userId: string) =>
    getPrisma().telephonyAgentEndpoint.findUnique({
      where: { providerKey_userId: { providerKey, userId } },
    }),
};
