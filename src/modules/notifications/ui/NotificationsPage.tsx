"use client";

// The notifications list. Opening one marks it read; a lead the person can no longer see shows that
// page's own friendly "not found". Admins and Managers can also choose what they get.
import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { NotificationList } from "./NotificationList";
import styles from "./notifications.module.css";

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
  return (
    <main className={styles.page}>
      <NotificationList />
      <Choices />
    </main>
  );
}
