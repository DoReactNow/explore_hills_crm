// Prisma access to the notifications module's tables. No business rules here.
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/db/prisma";

type Tx = Prisma.TransactionClient;

export const NOTIFICATION_SELECT = {
  id: true,
  kind: true,
  title: true,
  body: true,
  link: true,
  groupCount: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationsNotificationSelect;

export const notificationRepository = {
  /** These notices name the customer, so the wording goes when the customer's data does. */
  async eraseForLeads(tx: Tx, leadIds: readonly string[]): Promise<void> {
    await tx.notificationsNotification.updateMany({
      where: { link: { in: leadIds.map((id) => `/leads/${id}`) } },
      data: { body: "The customer's details were erased." },
    });
  },

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(work);
  },

  async lockUser(tx: Tx, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notify:${userId}`}, 0))`;
  },

  hasKey: (tx: Tx, userId: string, key: string) =>
    tx.notificationsNotification.findFirst({
      where: { userId, dedupeKeys: { has: key } },
      select: { id: true },
    }),

  findGroupable: (tx: Tx, userId: string, kind: string, since: Date) =>
    tx.notificationsNotification.findFirst({
      where: { userId, kind, readAt: null, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
    }),

  create: (tx: Tx, data: Prisma.NotificationsNotificationUncheckedCreateInput) =>
    tx.notificationsNotification.create({ data }),

  update: (tx: Tx, id: string, data: Prisma.NotificationsNotificationUncheckedUpdateInput) =>
    tx.notificationsNotification.update({ where: { id }, data }),

  findById: (id: string) => getPrisma().notificationsNotification.findUnique({ where: { id } }),

  list(userId: string, unreadOnly: boolean, skip: number, take: number) {
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    const prisma = getPrisma();
    return Promise.all([
      prisma.notificationsNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: NOTIFICATION_SELECT,
      }),
      prisma.notificationsNotification.count({ where: { userId, readAt: null } }),
    ]);
  },

  async markRead(userId: string, id: string, at: Date): Promise<void> {
    await getPrisma().notificationsNotification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: at },
    });
  },

  async markAllRead(userId: string, at: Date): Promise<void> {
    await getPrisma().notificationsNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: at },
    });
  },

  findPreference: (userId: string) =>
    getPrisma().notificationsPreference.findUnique({ where: { userId } }),

  savePreference: (
    tx: Tx,
    userId: string,
    data: { inApp: boolean; email: boolean; push: boolean },
  ) =>
    tx.notificationsPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    }),

  async saveSubscription(
    userId: string,
    data: { endpoint: string; p256dh: string; auth: string },
  ): Promise<void> {
    await getPrisma().notificationsPushSubscription.upsert({
      where: { endpoint: data.endpoint },
      create: { userId, ...data },
      update: { userId, p256dh: data.p256dh, auth: data.auth },
    });
  },

  async deleteSubscription(userId: string, endpoint: string): Promise<void> {
    await getPrisma().notificationsPushSubscription.deleteMany({ where: { userId, endpoint } });
  },

  async removeExpired(endpoint: string): Promise<void> {
    await getPrisma().notificationsPushSubscription.deleteMany({ where: { endpoint } });
  },

  subscriptionsOf: (userId: string) =>
    getPrisma().notificationsPushSubscription.findMany({ where: { userId } }),
};
