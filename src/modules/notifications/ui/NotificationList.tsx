"use client";

// The list of notifications with Unread / All and "Mark all as read", shared by the bell's panel and
// the notifications page (Shell-Overlays design). Opening one marks it read; a lead the person can no
// longer see shows that page's own friendly "not found".
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { formatInstant, parseInstant } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { Icon, type IconName } from "@/shared/ui/Icon";
import styles from "./notifications.module.css";

const NOTICES = ["notifications.changed"];

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** The icon and tint for a notice, read from its title, which names its kind. */
function lookOf(title: string): { icon: IconName; tone: string } {
  const text = title.toLowerCase();
  if (text.includes("missed call") || text.includes("call back"))
    return { icon: "missedCall", tone: styles.toneDanger };
  if (text.includes("late") || text.includes("manager") || text.includes("alert"))
    return { icon: "warning", tone: styles.toneWarning };
  if (text.includes("grabs") || text.includes("claimed"))
    return { icon: "check", tone: styles.toneGood };
  if (text.includes("follow-up")) return { icon: "followups", tone: styles.toneNeutral };
  if (text.includes("message")) return { icon: "inbox", tone: styles.toneInfo };
  return { icon: "plus", tone: styles.toneInfo };
}

export function NotificationList({
  onOpened,
  compact,
}: {
  /** Called after a notice is opened, so a panel can close itself. */
  onOpened?: () => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<FriendlyError | null>(null);

  const refresh = useCallback(async () => {
    const result = await apiRequest<{ items: Notification[]; unreadCount: number }>(
      `/api/notifications?unread=${unreadOnly}`,
    );
    if (result.ok) {
      setItems(result.data.items);
      setUnread(result.data.unreadCount);
    } else setError(result.error);
  }, [unreadOnly]);

  useLiveEvents({ types: NOTICES, onEvent: refresh, onResync: refresh });
  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  async function open(item: Notification) {
    if (!item.readAt) await apiRequest(`/api/notifications/${item.id}/read`, { method: "POST" });
    if (item.link) {
      onOpened?.();
      router.push(item.link);
    } else void refresh();
  }

  async function markAll() {
    await apiRequest("/api/notifications/read-all", { method: "POST" });
    void refresh();
  }

  const shown = compact ? items?.slice(0, 8) : items;
  return (
    <>
      <div className={styles.head}>
        {compact ? (
          <h2 className={styles.panelTitle}>Notifications</h2>
        ) : (
          <h1 className={styles.title}>Notifications</h1>
        )}
        <button type="button" className={styles.link} onClick={markAll}>
          Mark all as read
        </button>
      </div>
      <div className={styles.pills}>
        <button
          type="button"
          className={styles.pill}
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly(true)}
        >
          Unread · {unread}
        </button>
        <button
          type="button"
          className={styles.pill}
          aria-pressed={!unreadOnly}
          onClick={() => setUnreadOnly(false)}
        >
          All
        </button>
      </div>
      {error ? <ErrorMessage error={error} /> : null}
      {items?.length === 0 ? (
        <p className={styles.empty}>
          <span className={styles.emptyTitle}>All caught up</span>
          <span className={styles.muted}>New leads, missed calls and alerts show up here.</span>
        </p>
      ) : null}
      <ul className={styles.list}>
        {shown?.map((item) => {
          const look = lookOf(item.title);
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`${styles.item} ${item.readAt ? "" : styles.unread}`}
                onClick={() => open(item)}
              >
                <span className={`${styles.itemIcon} ${look.tone}`}>
                  <Icon name={look.icon} size={18} strokeWidth={1.9} />
                </span>
                <span className={styles.text}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  <span className={styles.body}>{item.body}</span>
                  <span className={styles.when}>
                    {formatInstant(parseInstant(item.createdAt), "dateTime")}
                  </span>
                </span>
                {item.readAt ? null : <span className={styles.dot} aria-label="Unread" />}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
