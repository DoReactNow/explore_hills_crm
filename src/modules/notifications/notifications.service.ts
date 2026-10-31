// Notifications and SLA (Decisions 63, 64). `notify` is how every module tells someone something: one
// event makes one notification, like events close together join up, and each person's choices apply.
import { recordAudit } from "@/modules/audit";
import {
  getNotifiableUser,
  getUserSummary,
  listHolders,
  listManagersAbove,
} from "@/modules/identity";
import { followUpsDue, leadsAwaitingResponse } from "@/modules/leads";
import { getSetting } from "@/modules/system";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors";
import { getJobQueue } from "@/shared/jobs";
import { logger } from "@/shared/logger";
import { assertCan } from "@/shared/rbac/assertCan";
import type { Principal } from "@/shared/rbac/principal";
import { publishEvent } from "@/shared/realtime/publish";
import {
  businessDateToDbDate,
  businessMoment,
  instantFromEpochMs,
  parseBusinessLocalDateTime,
  plusDuration,
  systemClock,
  type Clock,
} from "@/shared/time";
import { getEmailSender, getPushSender } from "./channels/registry";
import { PermanentDeliveryError, type EmailSender, type PushSender } from "./channels/types";
import { notificationsChangedEvent } from "./notifications.events";
import { sendEmailRef, sendPushRef } from "./notifications.jobdefs";
import { notificationRepository as repository } from "./notifications.repository";
import { GROUP_WINDOW_MS, NOTIFICATION_KINDS, type NotificationKind } from "./notifications.types";
import { addWorkingMinutes, isWorkingDay, type WorkingCalendar } from "./notifications.workingTime";

export interface NotificationContext {
  principal: Principal;
  requestId?: string;
}

export interface NotifyInput {
  userIds: readonly string[];
  kind: NotificationKind;
  /** The same key for the same event: delivered twice, it still notifies once. */
  key: string;
  body: string;
  link?: string;
}

/** An SLA looks back this far, so very old leads don't all fire when the feature first runs. */
const SLA_LOOK_BACK_DAYS = 14;
const SWEEP_LIMIT = 500;
const PAGE_SIZE = 50;

interface Deps {
  clock?: Clock;
  enqueue?: boolean;
  email?: () => EmailSender;
  push?: () => PushSender;
}

export function createNotificationService({
  clock = systemClock,
  enqueue = true,
  email = getEmailSender,
  push = getPushSender,
}: Deps = {}) {
  async function calendar(): Promise<WorkingCalendar> {
    const days = (await getSetting("telephony.workingDays")) as string;
    const holidays = (await getSetting("sla.holidays")) as string;
    return {
      days: days.split(",").map(Number),
      from: (await getSetting("telephony.workingFrom")) as string,
      to: (await getSetting("telephony.workingTo")) as string,
      holidays: holidays
        .split(",")
        .map((day) => day.trim())
        .filter(Boolean),
    };
  }

  async function notifyOne(userId: string, input: NotifyInput): Promise<void> {
    const user = await getUserSummary(userId);
    if (user?.status !== "ACTIVE") return;
    const preference = await repository.findPreference(userId);
    if (preference && !preference.inApp && !preference.email && !preference.push) return;

    const kind = NOTIFICATION_KINDS[input.kind];
    const now = clock.now();
    const since = instantFromEpochMs(now.getTime() - GROUP_WINDOW_MS);
    const made = await repository.transaction(async (tx) => {
      await repository.lockUser(tx, userId);
      if (await repository.hasKey(tx, userId, input.key)) return null;
      const group = await repository.findGroupable(tx, userId, input.kind, since);
      if (group) {
        const groupCount = group.groupCount + 1;
        await repository.update(tx, group.id, {
          groupCount,
          dedupeKeys: { push: input.key },
          title: `${groupCount} ${kind.grouped}`,
          body: "Open the list to see them.",
          link: kind.list,
        });
        return { id: group.id, fresh: false };
      }
      const row = await repository.create(tx, {
        userId,
        kind: input.kind,
        title: kind.single,
        body: input.body,
        link: input.link,
        dedupeKeys: [input.key],
        // Turned off in the app: kept out of the list, but email and push still go if they're on.
        readAt: preference && !preference.inApp ? now : null,
        createdAt: now,
      });
      return { id: row.id, fresh: true };
    });
    if (!made || !enqueue) return;
    await publishEvent(notificationsChangedEvent, { userId }).catch((error: unknown) =>
      logger.warn("could not publish a notification notice", { err: error }),
    );
    // Only the first of a group goes out, so email and push can't flood anyone either.
    if (!made.fresh) return;
    const queue = await getJobQueue();
    if (kind.email && (preference?.email ?? true)) {
      await queue.enqueue(sendEmailRef, { notificationId: made.id }, { singletonKey: made.id });
    }
    if (kind.push && (preference?.push ?? true)) {
      await queue.enqueue(sendPushRef, { notificationId: made.id }, { singletonKey: made.id });
    }
  }

  return {
    /** Never throws: a notification going wrong must not undo the work that caused it. */
    async notify(input: NotifyInput): Promise<void> {
      for (const userId of new Set(input.userIds)) {
        await notifyOne(userId, input).catch((error: unknown) =>
          logger.warn("could not create a notification", { err: error, kind: input.kind }),
        );
      }
    },

    async list({ principal }: NotificationContext, input: { unread: boolean; page: number }) {
      const [items, unreadCount] = await repository.list(
        principal.userId,
        input.unread,
        (input.page - 1) * PAGE_SIZE,
        PAGE_SIZE,
      );
      return { items, unreadCount, page: input.page, pageSize: PAGE_SIZE };
    },

    /** Someone else's notification simply isn't found, so this is safe to repeat. */
    async markRead({ principal }: NotificationContext, id: string) {
      await repository.markRead(principal.userId, id, clock.now());
      return { read: true };
    },

    async markAllRead({ principal }: NotificationContext) {
      await repository.markAllRead(principal.userId, clock.now());
      return { read: true };
    },

    async getPreferences({ principal }: NotificationContext) {
      const row = await repository.findPreference(principal.userId);
      return {
        inApp: row?.inApp ?? true,
        email: row?.email ?? true,
        push: row?.push ?? true,
        pushPublicKey: push().publicKey,
      };
    },

    /** Admins and Managers only: agents keep theirs, so no lead is missed (Decision 63). */
    async setPreferences(
      context: NotificationContext,
      input: { inApp: boolean; email: boolean; push: boolean },
    ) {
      const { principal, requestId } = context;
      assertCan(principal, "notifications:mute");
      await repository.transaction(async (tx) => {
        await repository.savePreference(tx, principal.userId, input);
        await recordAudit(tx, {
          action: "notifications.preferences_changed",
          entityType: "user",
          entityId: principal.userId,
          summary: "Notification choices changed",
          actor: { userId: principal.userId, roleCode: principal.roleCode },
          requestId,
          metadata: input,
        });
      });
      return this.getPreferences(context);
    },

    async subscribePush(
      { principal }: NotificationContext,
      input: { endpoint: string; p256dh: string; auth: string },
    ) {
      await repository.saveSubscription(principal.userId, input);
      return { subscribed: true };
    },

    async unsubscribePush({ principal }: NotificationContext, endpoint: string) {
      await repository.deleteSubscription(principal.userId, endpoint);
      return { subscribed: false };
    },

    /** A bad address fails only its own email; anything else is retried by the job. */
    async sendEmail(notificationId: string): Promise<void> {
      const row = await repository.findById(notificationId);
      if (!row) return;
      const user = await getNotifiableUser(row.userId);
      if (user?.status !== "ACTIVE") return;
      const link = row.link ? `\n\n${new URL(row.link, getEnv().APP_URL).toString()}` : "";
      try {
        await email().send({
          to: user.email,
          subject: row.title,
          text: `${row.body}${link}`,
        });
      } catch (error) {
        if (error instanceof PermanentDeliveryError) {
          logger.warn("an email address refused a notification", { notificationId });
          return;
        }
        throw error;
      }
    },

    /** An expired browser subscription is removed, and the others still get theirs. */
    async sendPush(notificationId: string): Promise<void> {
      const row = await repository.findById(notificationId);
      if (!row) return;
      const message = { title: row.title, body: row.body, link: row.link };
      let failure: unknown = null;
      for (const subscription of await repository.subscriptionsOf(row.userId)) {
        try {
          await push().send(subscription, message);
        } catch (error) {
          if (error instanceof PermanentDeliveryError) {
            await repository.removeExpired(subscription.endpoint);
          } else {
            failure = error;
          }
        }
      }
      if (failure) throw failure;
    },

    /**
     * First-reply clocks: the owner hears at the deadline, and managers at twice the target. Each fires
     * once however often this runs, because the key says what it's about (Decision 64).
     */
    async checkFirstResponses(): Promise<void> {
      const now = clock.now();
      const minutes = (await getSetting("sla.firstResponseMinutes")) as number;
      const working = await calendar();
      const since = plusDuration(now, { days: -SLA_LOOK_BACK_DAYS });
      const assigners = await listHolders("leads:assign");
      const everywhere = await listHolders("leads:view-all");
      for (const lead of await leadsAwaitingResponse(since, SWEEP_LIMIT)) {
        const due = addWorkingMinutes(lead.createdAt, minutes, working);
        // A reply at the exact deadline is on time, so only strictly later counts as late.
        if (!due || now.getTime() <= due.getTime()) continue;
        const name = lead.contact.name ?? "A customer";
        const link = `/leads/${lead.id}`;
        await this.notify({
          userIds: lead.ownerUserId ? [lead.ownerUserId] : assigners.map((person) => person.id),
          kind: "sla_missed",
          key: `sla-missed:${lead.id}:${lead.ownerUserId ?? "queue"}`,
          body: `${name} has had no reply. The target is ${minutes} min.`,
          link,
        });
        const later = addWorkingMinutes(lead.createdAt, minutes * 2, working);
        if (!later || now.getTime() <= later.getTime()) continue;
        const above = lead.ownerUserId ? await listManagersAbove(lead.ownerUserId) : [];
        // With no manager above the owner, it goes to those who can see every lead.
        const managers = above.length > 0 ? above : everywhere.map((person) => person.id);
        await this.notify({
          userIds: managers,
          kind: "sla_escalated",
          key: `sla-escalated:${lead.id}`,
          body: `${name} still has no reply, at twice the ${minutes} min target.`,
          link,
        });
      }
    },

    /**
     * Once on each working day, at the set time or the first chance after it, so a worker that was down
     * catches up. Completed or closed follow-ups aren't counted, because it reads them as it sends.
     */
    async sendDailyReminders(): Promise<void> {
      const now = clock.now();
      const { date } = businessMoment(now);
      if (!isWorkingDay(date, await calendar())) return;
      const at = (await getSetting("sla.reminderTime")) as string;
      if (now.getTime() < parseBusinessLocalDateTime(date, at).getTime()) return;
      for (const { userId, count } of await followUpsDue(businessDateToDbDate(date))) {
        await this.notify({
          userIds: [userId],
          kind: "followups_due",
          key: `followups:${date}:${userId}`,
          body: `You have ${count} follow-up${count === 1 ? "" : "s"} due or overdue.`,
          link: "/follow-ups",
        });
      }
    },

    async sweep(): Promise<void> {
      await this.checkFirstResponses();
      await this.sendDailyReminders();
    },
  };
}

export const notificationService = createNotificationService();

export const notify = (input: NotifyInput) => notificationService.notify(input);

export const assertNotificationId = (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND");
};
