"use client";

// The way to notifications, with the unread count kept live. It re-reads on a notice, which only says
// something changed; polling covers a lost connection.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import styles from "./notifications.module.css";

const NOTICES = ["notifications.changed"];

export function NotificationsLink() {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    const result = await apiRequest<{ unreadCount: number }>("/api/notifications?unread=true");
    if (result.ok) setUnread(result.data.unreadCount);
  }, []);
  useLiveEvents({ types: NOTICES, onEvent: refresh, onResync: refresh });
  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  return (
    <Link href="/notifications" className={styles.navLink}>
      Notifications
      {unread > 0 ? (
        <span className={styles.badge} aria-label={`${unread} unread`}>
          {unread}
        </span>
      ) : null}
    </Link>
  );
}
