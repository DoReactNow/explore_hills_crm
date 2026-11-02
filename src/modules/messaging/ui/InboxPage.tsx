"use client";

// The WhatsApp inbox (Inbox-Desktop, Inbox-Mobile designs). The open chat is in the URL, so Back and
// refresh return to it. Live notices only say something changed; the screen then re-reads through the
// normal API.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import {
  formatBusinessDate,
  formatRecent,
  parseInstant,
  systemClock,
  todayBusinessDate,
} from "@/shared/time";
import { Avatar, formatPhone } from "@/shared/ui/Avatar";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { Icon } from "@/shared/ui/Icon";
import { ChatThread, contactName, preview, type Detail, type ListItem } from "./chatParts";
import styles from "./messaging.module.css";

const NOTICE_TYPES = ["messaging.conversationChanged"];
type Tab = "mine" | "all" | "unread";

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function windowLeft(closesAt: string | null): string {
  if (!closesAt) return "";
  const minutes = Math.max(
    0,
    Math.floor((parseInstant(closesAt).getTime() - systemClock.now().getTime()) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} m left` : `${minutes} m left`;
}

function tripLine(lead: NonNullable<Detail["lead"]>): string {
  const { travelStartDate: start, travelEndDate: end } = lead;
  if (!start) return "—";
  const from = formatBusinessDate(start, "date");
  return end && end !== start ? `${from} – ${formatBusinessDate(end, "date")}` : from;
}

const recent = (iso: string | null) => (iso ? formatRecent(parseInstant(iso), systemClock) : "");

export function InboxPage() {
  const access = usePageAccess("messaging:view");
  const { can } = usePrincipal();
  const router = useRouter();
  const selectedId = useSearchParams().get("c");
  const seesOthers = can("leads:view-team") || can("leads:view-all");
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [detailError, setDetailError] = useState<FriendlyError | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [, setTick] = useState(0);
  const selectedRef = useRef(selectedId);

  const loadList = useCallback(async () => {
    const query = new URLSearchParams();
    if (search.trim()) query.set("search", search.trim());
    if (tab === "unread") query.set("unread", "true");
    if (tab === "mine" && seesOthers) query.set("mine", "true");
    const [result, unread] = await Promise.all([
      apiRequest<{ items: ListItem[] }>(`/api/conversations?${query}`),
      apiRequest<{ total: number }>("/api/conversations?unread=true&pageSize=1"),
    ]);
    if (result.ok) setItems(result.data.items);
    else setError(result.error);
    if (unread.ok) setUnreadTotal(unread.data.total);
  }, [search, tab, seesOthers]);

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
  }, [access, refresh, search, tab]);

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
  const today = todayBusinessDate(systemClock);
  const tabs: ReadonlyArray<{ key: Tab; label: string }> = seesOthers
    ? [
        { key: "mine", label: "Mine" },
        { key: "all", label: can("leads:view-all") ? "All" : "My team" },
        { key: "unread", label: `Unread · ${unreadTotal}` },
      ]
    : [
        { key: "all", label: "Mine" },
        { key: "unread", label: `Unread · ${unreadTotal}` },
      ];

  return (
    <main className={`${styles.inbox} ${selectedId ? styles.hasChat : ""}`}>
      <section aria-label="Conversations" className={styles.listPane}>
        <div className={styles.listHead}>
          <h1 className={styles.title}>Inbox</h1>
          {unreadTotal > 0 ? <span className={styles.muted}>{unreadTotal} unread</span> : null}
        </div>
        <div className={styles.searchBox}>
          <Icon name="search" size={18} />
          <input
            aria-label="Search name, phone or message"
            placeholder="Search name or phone"
            className={styles.searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className={styles.segmented} role="group" aria-label="Show">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={styles.segment}
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {!items ? <p aria-busy="true">Loading…</p> : null}
        {items?.length === 0 ? (
          <p className={styles.emptyList}>
            <span className={styles.emptyTitle}>All caught up</span>
            <span className={styles.muted}>New WhatsApp messages show up here.</span>
          </p>
        ) : null}
        <div className={styles.items}>
          {items?.map((item) => {
            const name = contactName(item);
            const fresh = item.unreadCount > 0 && item.id !== selectedId;
            return (
              <button
                key={item.id}
                type="button"
                className={styles.item}
                aria-current={item.id === selectedId}
                onClick={() => router.replace(`/inbox?c=${item.id}`, { scroll: false })}
              >
                <Avatar name={name} size={40} />
                <span className={styles.itemBody}>
                  <span className={styles.itemTop}>
                    <span className={styles.itemName}>{name}</span>
                    <span className={fresh ? `${styles.when} ${styles.whenFresh}` : styles.when}>
                      {recent(item.lastMessageAt)}
                    </span>
                  </span>
                  <span className={styles.itemTop}>
                    <span className={styles.itemPreview}>{preview(item.lastMessage)}</span>
                    {fresh ? (
                      <span className={styles.unread} aria-label={`${item.unreadCount} unread`}>
                        {item.unreadCount}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.itemMeta}>
                    {item.lead ? (
                      <>
                        <span className={styles.stageDot} data-stage={item.lead.stage.code} />
                        {item.lead.stage.name}
                        {item.lead.destination ? ` · ${item.lead.destination}` : ""}
                      </>
                    ) : (
                      "No open lead"
                    )}
                    {!item.window.open ? (
                      <span className={styles.closedTag}>Window closed</span>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Chat" className={styles.chatPane}>
        {!selectedId ? (
          <div className={styles.empty}>
            <Icon name="inbox" size={28} />
            Choose a conversation.
          </div>
        ) : null}
        {selectedId && detailError ? <ErrorMessage error={detailError} /> : null}
        {current ? (
          <>
            <header className={styles.chatHead}>
              <button
                type="button"
                className={styles.backButton}
                onClick={() => router.replace("/inbox", { scroll: false })}
                aria-label="Back to conversations"
              >
                <Icon name="back" size={20} />
              </button>
              <Avatar name={contactName(current)} size={36} />
              <span className={styles.chatName}>
                <strong>{contactName(current)}</strong>
                <span className={styles.muted}>
                  <span className={styles.chatPhone}>
                    {formatPhone(current.contact.phoneE164)}
                    {current.lead ? " · " : ""}
                  </span>
                  {current.lead ? <Link href={`/leads/${current.lead.id}`}>Open lead</Link> : null}
                </span>
              </span>
              <span
                className={current.window.open ? styles.windowOpen : styles.windowClosed}
                title={
                  current.window.open
                    ? "You can reply freely until the 24-hour window closes."
                    : "The 24-hour window has closed. Send an approved template."
                }
              >
                <Icon name="clock" size={14} strokeWidth={2} />
                {current.window.open ? windowLeft(current.window.closesAt) : "Window closed"}
              </span>
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
        {current?.lead ? (
          <>
            <span className={styles.sideLabel}>Lead</span>
            <span className={styles.stagePill} data-stage={current.lead.stage.code}>
              <span className={styles.stageDot} data-stage={current.lead.stage.code} />
              {current.lead.stage.name}
            </span>
            <dl className={styles.facts}>
              <dt>Trip</dt>
              <dd>{current.lead.destination ?? "—"}</dd>
              <dt>Dates</dt>
              <dd>{tripLine(current.lead)}</dd>
              <dt>People</dt>
              <dd>{current.lead.travellerCount ?? "—"}</dd>
              <dt>Budget</dt>
              <dd>
                {current.lead.budgetAmount ? rupees.format(Number(current.lead.budgetAmount)) : "—"}
              </dd>
              <dt>Owner</dt>
              <dd>{current.lead.owner?.name ?? "Unassigned"}</dd>
            </dl>
            {current.lead.nextFollowUpDate ? (
              <div
                className={
                  current.lead.nextFollowUpDate < today ? styles.followUpLate : styles.followUp
                }
              >
                <strong>
                  {current.lead.nextFollowUpDate < today
                    ? "Follow-up overdue"
                    : current.lead.nextFollowUpDate === today
                      ? "Follow-up today"
                      : "Next follow-up"}
                </strong>
                <span>{formatBusinessDate(current.lead.nextFollowUpDate, "date")}</span>
              </div>
            ) : null}
            <Link href={`/leads/${current.lead.id}`} className={styles.sideButton}>
              Open full lead
            </Link>
          </>
        ) : current ? (
          <>
            <span className={styles.sideLabel}>Customer</span>
            <span>{contactName(current)}</span>
            <span className={styles.muted}>{formatPhone(current.contact.phoneE164)}</span>
            <span className={styles.muted}>No open lead for this chat.</span>
          </>
        ) : null}
      </aside>
    </main>
  );
}
