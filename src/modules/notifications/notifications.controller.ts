// HTTP adapters for the notification routes. No business rules here.
import { z } from "zod";
import { AppError } from "@/shared/errors";
import type { RouteContext } from "@/shared/http/route";
import { assertNotificationId, notificationService as service } from "./notifications.service";

export const listNotificationsSchema = z.object({
  unread: z.enum(["true", "false"]).default("false"),
  page: z.coerce.number().int().min(1).default(1),
});
export const preferencesSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
});
export const subscribeSchema = z.object({
  endpoint: z.url().max(1000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
});
export const unsubscribeSchema = z.object({ endpoint: z.url().max(1000) });

type NoParams = Record<string, string>;
type IdParams = { id: string };

function context<I, P>({ principal, requestId }: RouteContext<I, P>) {
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return { principal, requestId };
}

export const notificationController = {
  async list(c: RouteContext<z.infer<typeof listNotificationsSchema>, NoParams>) {
    return {
      data: await service.list(context(c), {
        unread: c.input.unread === "true",
        page: c.input.page,
      }),
    };
  },
  async markRead(c: RouteContext<undefined, IdParams>) {
    assertNotificationId(c.params.id);
    return { data: await service.markRead(context(c), c.params.id) };
  },
  async markAllRead(c: RouteContext<undefined, NoParams>) {
    return { data: await service.markAllRead(context(c)) };
  },
  async getPreferences(c: RouteContext<undefined, NoParams>) {
    return { data: await service.getPreferences(context(c)) };
  },
  async setPreferences(c: RouteContext<z.infer<typeof preferencesSchema>, NoParams>) {
    return { data: await service.setPreferences(context(c), c.input) };
  },
  async subscribe(c: RouteContext<z.infer<typeof subscribeSchema>, NoParams>) {
    return { data: await service.subscribePush(context(c), c.input) };
  },
  async unsubscribe(c: RouteContext<z.infer<typeof unsubscribeSchema>, NoParams>) {
    return { data: await service.unsubscribePush(context(c), c.input.endpoint) };
  },
};
