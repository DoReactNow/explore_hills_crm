"use client";

// The WhatsApp inbox. The open chat is in the URL, so Back and refresh return to it. Live notices
// only say something changed; the screen then re-reads through the normal API.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePageAccess, usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { formatInstant, parseInstant, systemClock } from "@/shared/time";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import {
  FILE_TYPES,
  renderTemplate,
  templatePlaceholders,
  WHATSAPP_TEXT_LIMIT,
} from "../messaging.types";
import styles from "./messaging.module.css";

const SOON_MS = 60 * 60 * 1000;
const NOTICE_TYPES = ["messaging.conversationChanged"];

interface Message {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  mediaStatus: string | null;
  mediaFilename: string | null;
  status: string;
  failureMessage: string | null;
  occurredAt: string;
}
interface Conversation {
  id: string;
  waId: string;
  unreadCount: number;
  lastMessageAt: string | null;
  window: { open: boolean; closesAt: string | null };
  contact: { name: string | null; phoneE164: string; optInStatus: string };
  lead: {
    id: string;
    destination: string | null;
    stage: { name: string };
    owner: { name: string } | null;
  } | null;
}
interface ListItem extends Conversation {
  lastMessage: Message | null;
}
interface Detail extends Conversation {
  messages: Message[];
}
interface Template {
  id: string;
  name: string;
  language: string;
  body: string;
}

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Sending…",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  FAILED: "Not sent",
};

const contactName = (row: Conversation) => row.contact.name ?? `+${row.waId}`;
const timeLabel = (iso: string | null) => (iso ? formatInstant(parseInstant(iso), "dateTime") : "");

function preview(message: Message | null): string {
  if (!message) return "No messages yet";
  if (message.body) return message.body;
  const labels: Record<string, string> = {
    IMAGE: "Photo",
    DOCUMENT: "Document",
    AUDIO: "Voice message",
    VIDEO: "Video",
    UNSUPPORTED: "A message type we can't show",
  };
  return labels[message.type] ?? "Message";
}

function WindowLabel({ closesAt }: { closesAt: string }) {
  const left = parseInstant(closesAt).getTime() - systemClock.now().getTime();
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.max(0, Math.floor((left % 3_600_000) / 60_000));
  if (left < SOON_MS) {
    return (
      <span className={styles.windowSoon}>
        Window closes in {minutes} min · reply now to keep chatting freely
      </span>
    );
  }
  return (
    <span className={styles.windowOpen}>
      Reply window open · {hours} h {minutes} m left
    </span>
  );
}

function MessageBubble({
  message,
  onRetry,
  canSend,
}: {
  message: Message;
  onRetry: () => void;
  canSend: boolean;
}) {
  const inbound = message.direction === "INBOUND";
  const failed = message.status === "FAILED";
  const tone = failed ? styles.failedBubble : inbound ? styles.inbound : styles.outbound;
  const unreadable = message.type === "UNSUPPORTED";
  const file = !["TEXT", "TEMPLATE", "INTERACTIVE", "UNSUPPORTED"].includes(message.type);
  return (
    <div className={`${styles.bubble} ${inbound ? styles.inbound : styles.outbound} ${tone}`}>
      {unreadable ? (
        <span className={styles.placeholder}>
          The customer sent something we can&apos;t show here.
        </span>
      ) : null}
      {file ? (
        <div>
          {message.mediaStatus === "STORED" ? (
            <a href={`/api/messages/${message.id}/media`}>
              {message.mediaFilename ??
                `Download ${preview({ ...message, body: null }).toLowerCase()}`}
            </a>
          ) : message.mediaStatus === "FAILED" ? (
            <span className={styles.placeholder}>
              This file couldn&apos;t be saved. Ask the customer to send it again.
            </span>
          ) : (
            <span className={styles.placeholder}>Saving the file…</span>
          )}
        </div>
      ) : null}
      {message.body}
      <div className={styles.meta}>
        {timeLabel(message.occurredAt)}
        {inbound ? "" : ` · ${STATUS_LABELS[message.status] ?? message.status}`}
      </div>
      {failed ? (
        <div className={styles.meta}>
          {message.failureMessage}{" "}
          {canSend ? (
            <button type="button" className={styles.linkButton} onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TemplateDialog({
  conversation,
  onClose,
  onSent,
}: {
  conversation: Conversation;
  onClose: () => void;
  onSent: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Template | null>(null);
  const [variables, setVariables] = useState<string[]>([]);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef(crypto.randomUUID());

  useEffect(() => {
    apiRequest<Template[]>("/api/templates?approved=true").then((result) => {
      if (result.ok) setTemplates(result.data);
      else setError(result.error);
    });
  }, []);

  function choose(template: Template) {
    setChosen(template);
    setError(null);
    const count = templatePlaceholders(template.body).length;
    const known = [conversation.contact.name ?? "", conversation.lead?.destination ?? ""];
    setVariables(Array.from({ length: count }, (_, index) => known[index] ?? ""));
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!chosen || busy) return;
    setBusy(true);
    const result = await apiRequest(`/api/conversations/${conversation.id}/template`, {
      method: "POST",
      body: { templateId: chosen.id, variables, clientRef: clientRef.current },
    });
    setBusy(false);
    if (result.ok) onSent();
    else setError(result.error);
  }

  const shown = templates.filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const variableError = error?.fieldErrors?.find((item) => item.field === "variables")?.message;
  const rootError = error?.fieldErrors?.find((item) => item.field === "_root")?.message;

  return (
    <Dialog title={`Send a template to ${contactName(conversation)}`} onClose={onClose}>
      <form onSubmit={send} className={styles.picker} noValidate>
        {rootError ? (
          <div role="alert" className={styles.alert}>
            {rootError}
          </div>
        ) : error && !variableError ? (
          <ErrorMessage error={error} />
        ) : null}
        <input
          aria-label="Search templates"
          placeholder="Search templates"
          className={styles.control}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {shown.map((template) => (
          <button
            key={template.id}
            type="button"
            className={styles.templateOption}
            aria-pressed={chosen?.id === template.id}
            onClick={() => choose(template)}
          >
            <strong>{template.name}</strong>
            <span className={styles.muted}>{template.body}</span>
          </button>
        ))}
        {templates.length > 0 && shown.length === 0 ? (
          <span className={styles.muted}>No templates match.</span>
        ) : null}
        <span className={styles.muted}>Only approved templates are listed.</span>
        {chosen ? (
          <>
            {variables.map((value, index) => (
              <div key={index} className={styles.field}>
                <label htmlFor={`tv-${index}`}>Detail {index + 1}</label>
                <input
                  id={`tv-${index}`}
                  className={styles.control}
                  value={value}
                  onChange={(event) =>
                    setVariables((current) =>
                      current.map((item, at) => (at === index ? event.target.value : item)),
                    )
                  }
                />
              </div>
            ))}
            {variableError ? <span className={styles.fieldError}>{variableError}</span> : null}
            <div className={styles.preview}>
              {renderTemplate(
                chosen.body,
                variables.map((value, index) => value || `[detail ${index + 1}]`),
              )}
            </div>
          </>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={`${styles.button} ${styles.primary}`}
            disabled={!chosen || busy}
          >
            Send template
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Composer({ conversation, onChanged }: { conversation: Detail; onChanged: () => void }) {
  const { can } = usePrincipal();
  const [text, setText] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const clientRef = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);

  if (!can("messaging:send")) return null;

  const { optInStatus } = conversation.contact;
  const name = contactName(conversation);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await apiRequest(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: { body: text, clientRef: clientRef.current },
    });
    setBusy(false);
    if (result.ok) {
      clientRef.current = crypto.randomUUID();
      setText("");
      setError(null);
      onChanged();
    } else setError(result.error);
  }

  async function sendFile(file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("clientRef", crypto.randomUUID());
    const result = await apiRequest(`/api/conversations/${conversation.id}/media`, {
      method: "POST",
      formData: form,
    });
    if (fileInput.current) fileInput.current.value = "";
    if (result.ok) {
      setError(null);
      onChanged();
    } else setError(result.error);
  }

  async function recordAgreement() {
    const result = await apiRequest(`/api/conversations/${conversation.id}/opt-in`, {
      method: "POST",
    });
    if (result.ok) onChanged();
    else setError(result.error);
  }

  const fieldError = error?.fieldErrors?.[0]?.message;
  const errorLine = fieldError ? (
    <span role="alert" className={styles.fieldError}>
      {fieldError}
    </span>
  ) : error ? (
    <ErrorMessage error={error} />
  ) : null;

  if (optInStatus === "OPTED_OUT") {
    return (
      <section className={styles.composer} aria-label="Sending is blocked">
        <div role="alert" className={styles.alert}>
          {name} has opted out of WhatsApp messages. They need to send START to opt back in.
        </div>
      </section>
    );
  }

  if (!conversation.window.open) {
    return (
      <section className={styles.composer} aria-label="Reply window closed">
        {errorLine}
        {optInStatus === "OPTED_IN" ? (
          <div className={styles.notice}>
            <span>The 24-hour reply window has closed. Send an approved template.</span>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => setPicking(true)}
            >
              Choose a template
            </button>
          </div>
        ) : (
          <div role="alert" className={styles.notice}>
            <strong>We can&apos;t message {name} on WhatsApp yet</strong>
            <span className={styles.muted}>
              There&apos;s no record that they agreed to receive WhatsApp messages from us. Ask
              them, then record it here.
            </span>
            <button type="button" className={styles.button} onClick={recordAgreement}>
              Record agreement
            </button>
          </div>
        )}
        {picking ? (
          <TemplateDialog
            conversation={conversation}
            onClose={() => setPicking(false)}
            onSent={() => {
              setPicking(false);
              onChanged();
            }}
          />
        ) : null}
      </section>
    );
  }

  return (
    <form className={styles.composer} onSubmit={send} noValidate>
      {conversation.window.closesAt ? (
        <WindowLabel closesAt={conversation.window.closesAt} />
      ) : null}
      {errorLine}
      <div className={styles.composerRow}>
        <textarea
          aria-label="Type a message"
          placeholder="Type a message…"
          className={styles.textarea}
          maxLength={WHATSAPP_TEXT_LIMIT}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(event);
            }
          }}
        />
        <input
          ref={fileInput}
          type="file"
          hidden
          aria-label="Attach a file"
          accept={Object.keys(FILE_TYPES).join(",")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void sendFile(file);
          }}
        />
        <button type="button" className={styles.button} onClick={() => fileInput.current?.click()}>
          Attach
        </button>
        <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
          Send
        </button>
      </div>
    </form>
  );
}

export function InboxPage() {
  const access = usePageAccess("messaging:view");
  const { can } = usePrincipal();
  const router = useRouter();
  const selectedId = useSearchParams().get("c");
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [detailError, setDetailError] = useState<FriendlyError | null>(null);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [, setTick] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
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

  const lastId = detail?.messages.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [lastId]);

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

  async function retry(messageId: string) {
    const result = await apiRequest(`/api/messages/${messageId}/retry`, { method: "POST" });
    if (result.ok) refresh();
    else setDetailError(result.error);
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
            <div className={styles.messages} aria-live="polite">
              {current.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  canSend={can("messaging:send")}
                  onRetry={() => void retry(message.id)}
                />
              ))}
              <div ref={bottom} />
            </div>
            <Composer key={current.id} conversation={current} onChanged={refresh} />
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
