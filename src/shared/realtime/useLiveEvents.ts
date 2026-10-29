"use client";

// Browser side of live updates (Decision 28). Opens the stream, passes notices to onEvent, and
// calls onResync (re-fetch through the normal API) after a reconnect. While the stream is down it
// polls by calling onResync every pollIntervalMs. EventSource reconnects by itself.
import { useEffect, useRef, useState } from "react";

/** Default polling interval while the stream is down (system_settings realtime.pollFallbackSeconds from Phase 3). */
export const LIVE_POLL_FALLBACK_MS = 15_000;

export type LiveStatus = "connecting" | "live" | "polling";

export interface UseLiveEventsOptions {
  types: readonly string[];
  onEvent: (type: string, payload: unknown) => void;
  onResync: () => void;
  pollIntervalMs?: number;
  url?: string;
}

export function useLiveEvents({
  types,
  onEvent,
  onResync,
  pollIntervalMs = LIVE_POLL_FALLBACK_MS,
  url = "/api/events/stream",
}: UseLiveEventsOptions): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const handlers = useRef({ onEvent, onResync });
  useEffect(() => {
    handlers.current = { onEvent, onResync };
  });

  const typesKey = types.join(",");

  useEffect(() => {
    const source = new EventSource(url);
    let poll: ReturnType<typeof setInterval> | null = null;
    let opened = false;

    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };

    source.onopen = () => {
      if (opened) handlers.current.onResync(); // a reconnect: catch up on what was missed
      opened = true;
      stopPolling();
      setStatus("live");
    };
    source.onerror = () => {
      if (poll) return;
      poll = setInterval(() => handlers.current.onResync(), pollIntervalMs);
      setStatus("polling");
    };
    for (const type of typesKey.split(",").filter(Boolean)) {
      source.addEventListener(type, (event) => {
        try {
          handlers.current.onEvent(type, JSON.parse((event as MessageEvent<string>).data));
        } catch {
          // ignore a malformed notice; the next re-fetch corrects the screen
        }
      });
    }

    return () => {
      stopPolling();
      source.close();
    };
  }, [typesKey, pollIntervalMs, url]);

  return status;
}
