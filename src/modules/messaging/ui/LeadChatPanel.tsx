"use client";

// The chat on a lead's page. Looking at a lead creates nothing: a chat starts only when asked.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { ChatThread, type Detail } from "./chatParts";
import styles from "./messaging.module.css";

const NOTICE_TYPES = ["messaging.conversationChanged"];

export function LeadChatPanel({ leadId }: { leadId: string }) {
  const { can } = usePrincipal();
  const allowed = can("messaging:view");
  const [chatId, setChatId] = useState<string | null | undefined>(undefined);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const idRef = useRef<string | null | undefined>(undefined);

  const loadChat = useCallback(async (id: string) => {
    const result = await apiRequest<Detail>(`/api/conversations/${id}`);
    if (result.ok) {
      setDetail(result.data);
      if (result.data.unreadCount > 0) {
        void apiRequest(`/api/conversations/${id}/read`, { method: "POST" });
      }
    } else setError(result.error);
  }, []);

  const refresh = useCallback(async () => {
    const found = await apiRequest<{ conversationId: string | null }>(
      `/api/leads/${leadId}/conversation`,
    );
    if (!found.ok) {
      setError(found.error);
      return;
    }
    idRef.current = found.data.conversationId;
    setChatId(found.data.conversationId);
    if (found.data.conversationId) await loadChat(found.data.conversationId);
  }, [leadId, loadChat]);

  useLiveEvents({ types: NOTICE_TYPES, onEvent: refresh, onResync: refresh });

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [allowed, refresh]);

  if (!allowed) return null;

  async function start() {
    const result = await apiRequest<{ id: string }>(`/api/leads/${leadId}/conversation`, {
      method: "POST",
    });
    if (result.ok) await refresh();
    else setError(result.error);
  }

  return (
    <section aria-label="Chat" className={styles.leadChat}>
      {error ? <ErrorMessage error={error} /> : null}
      {chatId === undefined && !error ? <p aria-busy="true">Loading…</p> : null}
      {chatId === null ? (
        <div className={styles.empty}>
          <p>No WhatsApp chat with this customer yet.</p>
          <button type="button" className={styles.button} onClick={start}>
            Start a chat
          </button>
        </div>
      ) : null}
      {detail ? (
        <ChatThread key={detail.id} conversation={detail} onChanged={refresh} onError={setError} />
      ) : null}
    </section>
  );
}
