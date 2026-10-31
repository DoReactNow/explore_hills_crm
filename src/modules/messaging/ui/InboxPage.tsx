"use client";

// The WhatsApp inbox. The open chat is in the URL, so Back and refresh return to it. Live notices
// only say something changed; the screen then re-reads through the normal API.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import {
  ChatThread,
  contactName,
  preview,
  timeLabel,
  type Detail,
  type ListItem,
} from "./chatParts";
import styles from "./messaging.module.css";

const NOTICE_TYPES = ["messaging.conversationChanged"];

export function InboxPage() {
  const access = usePageAccess("messaging:view");
  const router = useRouter();
  const selectedId = useSearchParams().get("c");
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [detailError, setDetailError] = useState<FriendlyError | null>(null);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [, setTick] = useState(0);
  const selectedRef = useRef(selectedId);

  const loadList = useCallback(async () => {
    const query = new URLSearchParams();
    if (search.trim()) query.set("search", search.trim());
    if (unreadOnly) query.set("unread", "true");
    const result = await apiRequest<{ items: ListItem[] }>(`/api/conversations?${query}`);
    if (result.ok) setItems(result.data.items);
    else setError(result.error);
  }, [search, unreadOnly]);

  const loadDetail = useCallback(async (id: string) => {
    const result = await apiRequest<Detail>(`/api/conversations/${id}`);
    if (selectedRef.current !== id) return; // a slow answer must not replace the newer chat
    if (result.ok) {
      setDetail(result.data);
      setDetailError(null);
    } else setDetailError(result.error);
  }, []);

  const refresh = useCallback(() => {
    void loadList();
    if (selectedRef.current) void loadDetail(selectedRef.current);
  }, [loadDetail, loadList]);

  useLiveEvents({ types: NOTICE_TYPES, onEvent: refresh, onResync: refresh });

  useEffect(() => {
    if (access !== "allowed") return;
    const timer = setTimeout(refresh, 200);
    return () => clearTimeout(timer);
  }, [access, refresh, search, unreadOnly]);

  useEffect(() => {
    selectedRef.current = selectedId;
    if (access !== "allowed" || !selectedId) return;
    apiRequest<Detail>(`/api/conversations/${selectedId}`).then((result) => {
      if (selectedRef.current !== selectedId) return;
      if (result.ok) {
        setDetail(result.data);
        setDetailError(null);
      } else setDetailError(result.error);
    });
  }, [access, selectedId]);

  const unread = detail?.unreadCount ?? 0;
  useEffect(() => {
    if (!detail || unread === 0) return;
    void apiRequest(`/api/conversations/${detail.id}/read`, { method: "POST" });
  }, [detail, unread]);

  // Keeps the window countdown honest while the screen is open.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (access === "loading") return <main>Loading…</main>;
  if (access !== "allowed" || error) {
    return (
      <main>
        <h1 className={styles.title}>Inbox</h1>
        <ErrorMessage error={(access !== "allowed" ? access : error) as FriendlyError} />
      </main>
    );
  }

  const current = detail && detail.id === selectedId ? detail : null;

  return (
    <main className={`${styles.inbox} ${selectedId ? styles.hasChat : ""}`}>
      <section aria-label="Conversations" className={styles.listPane}>
        <h1 className={styles.title}>Inbox</h1>
        <input
          aria-label="Search name or phone"
          placeholder="Search name or phone"
          className={styles.control}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className={styles.pills}>
          <button
            type="button"
            className={styles.pill}
            aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
          >
            All
          </button>
          <button
            type="button"
            className={styles.pill}
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}
          >
            Unread
          </button>
        </div>
        {!items ? <p aria-busy="true">Loading…</p> : null}
        {items?.length === 0 ? <p className={styles.muted}>No conversations here.</p> : null}
        {items?.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.item}
            aria-current={item.id === selectedId}
            onClick={() => router.replace(`/inbox?c=${item.id}`, { scroll: false })}
          >
            <span className={styles.itemTop}>
              <span className={styles.itemName}>{contactName(item)}</span>
              {item.unreadCount > 0 && item.id !== selectedId ? (
                <span className={styles.unread} aria-label={`${item.unreadCount} unread`}>
                  {item.unreadCount}
                </span>
              ) : null}
            </span>
            <span className={styles.itemPreview}>{preview(item.lastMessage)}</span>
            <span className={styles.when}>{timeLabel(item.lastMessageAt)}</span>
          </button>
        ))}
      </section>

      <section aria-label="Chat" className={styles.chatPane}>
        {!selectedId ? <div className={styles.empty}>Choose a conversation.</div> : null}
        {selectedId && detailError ? <ErrorMessage error={detailError} /> : null}
        {current ? (
          <>
            <header className={styles.chatHead}>
              <button
                type="button"
                className={styles.button}
                onClick={() => router.replace("/inbox", { scroll: false })}
                aria-label="Back to conversations"
              >
                ←
              </button>
              <span className={styles.chatName}>
                <strong>{contactName(current)}</strong>
                <span className={styles.muted}>
                  {current.lead?.stage.name ?? "No open lead"}
                  {current.lead?.destination ? ` · ${current.lead.destination}` : ""}
                </span>
              </span>
              {current.lead ? (
                <Link href={`/leads/${current.lead.id}`} className={styles.button}>
                  Open lead
                </Link>
              ) : null}
            </header>
            <ChatThread
              key={current.id}
              conversation={current}
              onChanged={refresh}
              onError={setDetailError}
            />
          </>
        ) : null}
      </section>

      <aside aria-label="Lead" className={styles.sidePane}>
        {current ? (
          <>
            <span className={styles.sideLabel}>Customer</span>
            <span>{contactName(current)}</span>
            <span className={styles.muted}>{current.contact.phoneE164}</span>
            <span className={styles.sideLabel}>Lead</span>
            <span>{current.lead?.stage.name ?? "—"}</span>
            <span>{current.lead?.destination ?? "No destination yet"}</span>
            <span className={styles.sideLabel}>Owner</span>
            <span>{current.lead?.owner?.name ?? "Unassigned"}</span>
          </>
        ) : null}
      </aside>
    </main>
  );
}
