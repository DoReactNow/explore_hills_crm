"use client";

// The bell in the top bar, with the unread count kept live, opening the notifications panel
// (Shell-Overlays design). It re-reads on a notice, which only says something changed; polling covers
// a lost connection.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { Icon } from "@/shared/ui/Icon";
import { NotificationList } from "./NotificationList";
import styles from "./notifications.module.css";

const NOTICES = ["notifications.changed"];

export function NotificationsBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    const result = await apiRequest<{ unreadCount: number }>("/api/notifications?unread=true");
    if (result.ok) setUnread(result.data.unreadCount);
  }, []);
  useLiveEvents({ types: NOTICES, onEvent: refresh, onResync: refresh });
  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // The page itself is the list, so on it the bell just names the count.
  if (pathname === "/notifications") {
    return (
      <span className={styles.bell}>
        <Icon name="bell" size={18} />
        <span className={styles.bellText}>Notifications</span>
        {unread > 0 ? <span className={styles.badge}>{unread}</span> : null}
      </span>
    );
  }
  return (
    <div className={styles.bellWrap} ref={wrap}>
      <button
        type="button"
        className={styles.bell}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="bell" size={18} />
        <span className={styles.bellText}>Notifications</span>
        {unread > 0 ? (
          <span className={styles.badge}>
            {unread > 99 ? "99+" : unread}
            <span className={styles.srOnly}> unread</span>
          </span>
        ) : null}
      </button>
      {open ? (
        <section role="dialog" aria-label="Notifications" className={styles.panel}>
          <NotificationList compact onOpened={() => setOpen(false)} />
          <Link href="/notifications" className={styles.panelFooter} onClick={() => setOpen(false)}>
            See all and choose what you get
          </Link>
        </section>
      ) : null}
    </div>
  );
}
