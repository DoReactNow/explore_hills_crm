"use client";

// The pieces of a chat, used by the inbox and by the panel on a lead: bubbles, the composer, and the
// scrolling thread, which keeps its place when older messages load or new ones arrive.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { formatInstant, parseInstant, systemClock } from "@/shared/time";
import { Dialog } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { useUnsavedWarning } from "@/shared/ui/useUnsavedWarning";
import {
  FILE_TYPES,
  renderTemplate,
  templatePlaceholders,
  WHATSAPP_TEXT_LIMIT,
} from "../messaging.types";
import styles from "./messaging.module.css";

const SOON_MS = 60 * 60 * 1000;

export interface Message {
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
export interface Conversation {
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
export interface ListItem extends Conversation {
  lastMessage: Message | null;
}
export interface Detail extends Conversation {
  hasOlder: boolean;
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

export const contactName = (row: Conversation) => row.contact.name ?? `+${row.waId}`;
export const timeLabel = (iso: string | null) =>
  iso ? formatInstant(parseInstant(iso), "dateTime") : "";

export function preview(message: Message | null): string {
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

export function MessageBubble({
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

export function Composer({
  conversation,
  onChanged,
}: {
  conversation: Detail;
  onChanged: () => void;
}) {
  const { can } = usePrincipal();
  const [text, setText] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedWarning(text.trim().length > 0);
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

/** How close to the end still counts as reading the newest message. */
const NEAR_BOTTOM_PX = 80;

export function ChatThread({
  conversation,
  onChanged,
  onError,
}: {
  conversation: Detail;
  onChanged: () => void;
  onError: (error: FriendlyError) => void;
}) {
  const { can } = usePrincipal();
  const [older, setOlder] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(conversation.hasOlder);
  const [loading, setLoading] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const heightBefore = useRef<number | null>(null);

  const scrollToEnd = useCallback(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
    nearBottom.current = true;
    setNewBelow(false);
  }, []);

  const latest = new Set(conversation.messages.map((message) => message.id));
  const messages = [
    ...older.filter((message) => !latest.has(message.id)),
    ...conversation.messages,
  ];
  const last = conversation.messages.at(-1);

  // New messages follow only someone already at the end, or their own message.
  useLayoutEffect(() => {
    if (nearBottom.current || last?.direction === "OUTBOUND") scrollToEnd();
    else setNewBelow(true);
  }, [last?.id, last?.direction, scrollToEnd]);

  // Older messages grow the list upward, so the same message stays under the reader's eye.
  useLayoutEffect(() => {
    if (heightBefore.current === null || !box.current) return;
    box.current.scrollTop += box.current.scrollHeight - heightBefore.current;
    heightBefore.current = null;
  }, [older]);

  async function loadOlder() {
    const first = messages[0];
    if (!first || loading) return;
    setLoading(true);
    const result = await apiRequest<{ messages: Message[]; hasOlder: boolean }>(
      `/api/conversations/${conversation.id}/messages?before=${first.id}`,
    );
    setLoading(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    heightBefore.current = box.current?.scrollHeight ?? null;
    setOlder((now) => [...result.data.messages, ...now]);
    setHasOlder(result.data.hasOlder);
  }

  async function retry(messageId: string) {
    const result = await apiRequest(`/api/messages/${messageId}/retry`, { method: "POST" });
    if (result.ok) onChanged();
    else onError(result.error);
  }

  return (
    <>
      <div
        ref={box}
        className={styles.messages}
        aria-live="polite"
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
          nearBottom.current = scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_PX;
          if (nearBottom.current) setNewBelow(false);
        }}
      >
        {hasOlder ? (
          <button type="button" className={styles.button} disabled={loading} onClick={loadOlder}>
            {loading ? "Loading…" : "Load older messages"}
          </button>
        ) : null}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            canSend={can("messaging:send")}
            onRetry={() => void retry(message.id)}
          />
        ))}
      </div>
      {newBelow ? (
        <button type="button" className={styles.newBelow} onClick={scrollToEnd}>
          New message ↓
        </button>
      ) : null}
      <Composer key={conversation.id} conversation={conversation} onChanged={onChanged} />
    </>
  );
}
