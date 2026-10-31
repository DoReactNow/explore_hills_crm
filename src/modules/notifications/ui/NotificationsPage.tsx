"use client";

// The notifications list. Opening one marks it read; a lead the person can no longer see shows that
// page's own friendly "not found". Admins and Managers can also choose what they get.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { formatInstant, parseInstant } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
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
interface Preferences {
  inApp: boolean;
  email: boolean;
  push: boolean;
  pushPublicKey: string | null;
}

function toKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const clean = key.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function Choices() {
  const { can } = usePrincipal();
  const [choices, setChoices] = useState<Preferences | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [pushNote, setPushNote] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Preferences>("/api/notifications/preferences", { signal: controller.signal }).then(
      (result) => {
        if (result.ok) setChoices(result.data);
      },
    );
    return () => controller.abort();
  }, []);

  async function save(next: Preferences) {
    const { inApp, email, push } = next;
    setChoices(next);
    const result = await apiRequest("/api/notifications/preferences", {
      method: "PUT",
      body: { inApp, email, push },
    });
    if (!result.ok) setError(result.error);
  }

  async function enablePush() {
    if (!choices?.pushPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushNote("This browser can't show push notifications.");
      return;
    }
    if ((await Notification.requestPermission()) !== "granted") {
      setPushNote("Your browser is blocking notifications from this site.");
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKeyBytes(choices.pushPublicKey),
    });
    const { endpoint, keys } = subscription.toJSON();
    const result = await apiRequest("/api/notifications/push", {
      method: "POST",
      body: { endpoint, p256dh: keys?.p256dh, auth: keys?.auth },
    });
    setPushNote(result.ok ? "Push notifications are on for this browser." : "");
    if (!result.ok) setError(result.error);
  }

  if (!choices) return null;
  const mute = can("notifications:mute");
  return (
    <section className={styles.card} aria-label="Notification choices">
      <h2>Your choices</h2>
      {error ? <ErrorMessage error={error} /> : null}
      {mute ? (
        (["inApp", "email", "push"] as const).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={choices[key]}
              onChange={(event) => save({ ...choices, [key]: event.target.checked })}
            />{" "}
            {key === "inApp" ? "In the app" : key === "email" ? "By email" : "By push"}
          </label>
        ))
      ) : (
        <span className={styles.muted}>Notifications stay on, so you never miss a lead.</span>
      )}
      <button type="button" className={styles.button} onClick={enablePush}>
        Turn on push for this browser
      </button>
      {pushNote ? (
        <span role="status" className={styles.muted}>
          {pushNote}
        </span>
      ) : null}
    </section>
  );
}

export function NotificationsPage() {
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
    if (item.link) router.push(item.link);
    else void refresh();
  }

  async function markAll() {
    await apiRequest("/api/notifications/read-all", { method: "POST" });
    void refresh();
  }

  return (
    <main className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Notifications</h1>
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
        <p className={styles.muted}>Nothing here. You&apos;re all caught up.</p>
      ) : null}
      <ul className={styles.list}>
        {items?.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`${styles.item} ${item.readAt ? "" : styles.unread}`}
              onClick={() => open(item)}
            >
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
        ))}
      </ul>
      <Choices />
    </main>
  );
}
