// Prisma access to the messaging module's tables. No business rules here. Conversations are read
// through their lead's scope, so a person sees exactly the chats of the leads they can see.
import { Prisma } from "@/generated/prisma/client";
import { scopeWhere, type LeadScope } from "@/modules/leads";
import { getPrisma } from "@/shared/db/prisma";

export type Tx = Prisma.TransactionClient;

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  type: true,
  body: true,
  mediaStatus: true,
  mediaMimeType: true,
  mediaFilename: true,
  templateName: true,
  status: true,
  failureCode: true,
  occurredAt: true,
  deliveredAt: true,
  readAt: true,
  conversationId: true,
  sentBy: { select: { id: true, name: true } },
} satisfies Prisma.MessagingMessageSelect;

export type MessageRow = Prisma.MessagingMessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

const CONVERSATION_SELECT = {
  id: true,
  waId: true,
  lastInboundAt: true,
  lastMessageAt: true,
  unreadCount: true,
  contact: { select: { id: true, name: true, phoneE164: true, optInStatus: true } },
  lead: {
    select: {
      id: true,
      destination: true,
      stage: { select: { code: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.MessagingConversationSelect;

export type ConversationRow = Prisma.MessagingConversationGetPayload<{
  select: typeof CONVERSATION_SELECT;
}>;

const visible = (scope: LeadScope): Prisma.MessagingConversationWhereInput => ({
  lead: { deletedAt: null, ...scopeWhere(scope) },
});

export const messagingRepository = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work);
  },

  async storeEvents(
    rows: ReadonlyArray<{
      eventKey: string;
      kind: string;
      waMessageId: string | null;
      payload: Prisma.InputJsonValue;
    }>,
  ) {
    const prisma = getPrisma();
    await prisma.messagingWebhookEvent.createMany({ data: [...rows], skipDuplicates: true });
    return prisma.messagingWebhookEvent.findMany({
      where: { eventKey: { in: rows.map((row) => row.eventKey) } },
      select: { id: true, eventKey: true, processedAt: true },
    });
  },

  findEvent(id: string) {
    return getPrisma().messagingWebhookEvent.findUnique({ where: { id } });
  },

  async markEvent(tx: Tx | null, id: string, data: { processedAt?: Date; error?: string | null }) {
    await (tx ?? getPrisma()).messagingWebhookEvent.update({ where: { id }, data });
  },

  pendingStatusEvents(waMessageId: string) {
    return getPrisma().messagingWebhookEvent.findMany({
      where: { waMessageId, kind: "status", processedAt: null },
      orderBy: { receivedAt: "asc" },
      select: { id: true },
    });
  },

  upsertConversation(
    tx: Tx,
    data: { businessPhoneNumberId: string; waId: string; contactId: string; leadId: string },
  ) {
    const { businessPhoneNumberId, waId, ...rest } = data;
    return tx.messagingConversation.upsert({
      where: { businessPhoneNumberId_waId: { businessPhoneNumberId, waId } },
      create: data,
      update: rest,
      select: { id: true },
    });
  },

  /** Inserts once per provider ID. Null means this message was already stored. */
  async insertInbound(
    tx: Tx,
    data: Prisma.MessagingMessageUncheckedCreateInput,
  ): Promise<string | null> {
    const { count } = await tx.messagingMessage.createMany({ data: [data], skipDuplicates: true });
    return count === 1 ? (data.id as string) : null;
  },

  /** A late message can't move the times backward; the unread count is a single atomic step. */
  async recordInboundOnConversation(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.$executeRaw`
      UPDATE messaging_conversations SET
        "unreadCount" = "unreadCount" + 1,
        "lastInboundAt" = GREATEST("lastInboundAt", ${at}::timestamptz),
        "lastMessageAt" = GREATEST("lastMessageAt", ${at}::timestamptz),
        "updatedAt" = now()
      WHERE id = ${id}::uuid`;
  },

  async recordOutboundOnConversation(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.$executeRaw`
      UPDATE messaging_conversations SET
        "lastMessageAt" = GREATEST("lastMessageAt", ${at}::timestamptz),
        "updatedAt" = now()
      WHERE id = ${id}::uuid`;
  },

  async markRead(id: string): Promise<void> {
    await getPrisma().messagingConversation.update({ where: { id }, data: { unreadCount: 0 } });
  },

  findMessageByWaId(tx: Tx, waMessageId: string) {
    return tx.messagingMessage.findUnique({
      where: { waMessageId },
      select: { id: true, conversationId: true },
    });
  },

  /** Moves a status forward only: `from` lists the states it may move from. */
  async advanceStatus(
    tx: Tx,
    id: string,
    from: ReadonlyArray<"QUEUED" | "SENT" | "DELIVERED">,
    data: Prisma.MessagingMessageUncheckedUpdateManyInput,
  ): Promise<void> {
    await tx.messagingMessage.updateMany({ where: { id, status: { in: [...from] } }, data });
  },

  async setDeliveredAtIfEmpty(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.messagingMessage.updateMany({
      where: { id, deliveredAt: null },
      data: { deliveredAt: at },
    });
  },

  async setTemplateStatus(
    tx: Tx,
    name: string,
    language: string,
    status: string,
    reason: string | null,
  ) {
    await tx.messagingTemplate.updateMany({
      where: { name, language },
      data: { status, rejectedReason: reason },
    });
  },

  async listConversations(query: {
    scope: LeadScope;
    skip: number;
    take: number;
    search?: string;
    phoneDigits?: string;
    unreadOnly: boolean;
  }) {
    const where: Prisma.MessagingConversationWhereInput = {
      ...visible(query.scope),
      ...(query.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
      ...(query.search
        ? {
            OR: [
              { contact: { name: { contains: query.search, mode: "insensitive" as const } } },
              ...(query.phoneDigits ? [{ waId: { contains: query.phoneDigits } }] : []),
            ],
          }
        : {}),
    };
    const prisma = getPrisma();
    const [rows, total] = await Promise.all([
      prisma.messagingConversation.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        skip: query.skip,
        take: query.take,
        select: {
          ...CONVERSATION_SELECT,
          messages: { orderBy: { occurredAt: "desc" }, take: 1, select: MESSAGE_SELECT },
        },
      }),
      prisma.messagingConversation.count({ where }),
    ]);
    return { rows, total };
  },

  findConversation(id: string, scope: LeadScope) {
    return getPrisma().messagingConversation.findFirst({
      where: { id, ...visible(scope) },
      select: CONVERSATION_SELECT,
    });
  },

  conversationMessages(id: string) {
    return getPrisma().messagingMessage.findMany({
      where: { conversationId: id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 200,
      select: MESSAGE_SELECT,
    });
  },

  async isConversationVisible(id: string, scope: LeadScope): Promise<boolean> {
    const count = await getPrisma().messagingConversation.count({
      where: { id, ...visible(scope) },
    });
    return count === 1;
  },

  findByClientRef(tx: Tx | null, clientRef: string) {
    return (tx ?? getPrisma()).messagingMessage.findUnique({
      where: { clientRef },
      select: MESSAGE_SELECT,
    });
  },

  createOutbound(tx: Tx, data: Prisma.MessagingMessageUncheckedCreateInput) {
    return tx.messagingMessage.create({ data, select: MESSAGE_SELECT });
  },

  /** Everything the send job needs, read fresh when it runs. */
  findForSend(id: string) {
    return getPrisma().messagingMessage.findUnique({
      where: { id },
      include: {
        conversation: { include: { contact: { select: { optInStatus: true } } } },
      },
    });
  },

  async updateMessage(
    id: string,
    data: Prisma.MessagingMessageUncheckedUpdateInput,
  ): Promise<void> {
    await getPrisma().messagingMessage.update({ where: { id }, data });
  },

  /** FAILED back to QUEUED, once. False if someone else already retried it. */
  async requeueIfFailed(id: string): Promise<boolean> {
    const { count } = await getPrisma().messagingMessage.updateMany({
      where: { id, status: "FAILED" },
      data: { status: "QUEUED", failureCode: null },
    });
    return count === 1;
  },

  findMessageForAccess(id: string, scope: LeadScope) {
    return getPrisma().messagingMessage.findFirst({
      where: { id, conversation: visible(scope) },
      select: {
        id: true,
        status: true,
        type: true,
        templateId: true,
        mediaRef: true,
        mediaStatus: true,
        mediaMimeType: true,
        mediaFilename: true,
        conversationId: true,
      },
    });
  },

  async moveConversations(tx: Tx, fromLeadId: string, toLeadId: string): Promise<void> {
    await tx.messagingConversation.updateMany({
      where: { leadId: fromLeadId },
      data: { leadId: toLeadId },
    });
  },

  listTemplates(approvedOnly: boolean) {
    return getPrisma().messagingTemplate.findMany({
      where: approvedOnly ? { status: "APPROVED" } : {},
      orderBy: [{ name: "asc" }, { language: "asc" }],
    });
  },

  findTemplate(id: string) {
    return getPrisma().messagingTemplate.findUnique({ where: { id } });
  },

  createTemplate(tx: Tx, data: Prisma.MessagingTemplateUncheckedCreateInput) {
    return tx.messagingTemplate.create({ data });
  },

  updateTemplate(tx: Tx, id: string, data: Prisma.MessagingTemplateUncheckedUpdateInput) {
    return tx.messagingTemplate.update({ where: { id }, data });
  },

  async deleteTemplate(tx: Tx, id: string): Promise<void> {
    await tx.messagingTemplate.delete({ where: { id } });
  },
};

export type MessagingRepository = typeof messagingRepository;
