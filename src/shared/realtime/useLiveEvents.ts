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

interface Subscriber {
  types: ReadonlySet<string>;
  onOpen(reconnected: boolean): void;
  onError(): void;
  onEvent(type: string, payload: unknown): void;
}

interface SharedStream {
  source: EventSource;
  subscribers: Set<Subscriber>;
  listening: Set<string>;
  opened: boolean;
  live: boolean;
}

/**
 * One connection per tab, however many parts of the screen listen. Browsers allow only six to a site
 * over HTTP/1.1, so one each would soon stall everything else.
 */
const streams = new Map<string, SharedStream>();

function subscribe(url: string, subscriber: Subscriber): () => void {
  let stream = streams.get(url);
  if (!stream) {
    const source = new EventSource(url);
    const made: SharedStream = {
      source,
      subscribers: new Set(),
      listening: new Set(),
      opened: false,
      live: false,
    };
    source.onopen = () => {
      const reconnected = made.opened;
      made.opened = true;
      made.live = true;
      for (const each of [...made.subscribers]) each.onOpen(reconnected);
    };
    source.onerror = () => {
      made.live = false;
      for (const each of [...made.subscribers]) each.onError();
    };
    streams.set(url, made);
    stream = made;
  }
  const shared = stream;
  for (const type of subscriber.types) {
    if (shared.listening.has(type)) continue;
    shared.listening.add(type);
    shared.source.addEventListener(type, (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse((event as MessageEvent<string>).data);
      } catch {
        return; // ignore a malformed notice; the next re-fetch corrects the screen
      }
      for (const each of [...shared.subscribers]) {
        if (each.types.has(type)) each.onEvent(type, payload);
      }
    });
  }
  shared.subscribers.add(subscriber);
  if (shared.live) subscriber.onOpen(false);
  return () => {
    shared.subscribers.delete(subscriber);
    if (shared.subscribers.size === 0) {
      shared.source.close();
      streams.delete(url);
    }
  };
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
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    const unsubscribe = subscribe(url, {
      types: new Set(typesKey.split(",").filter(Boolean)),
      onOpen(reconnected) {
        if (reconnected) handlers.current.onResync(); // catch up on what was missed
        stopPolling();
        setStatus("live");
      },
      onError() {
        if (poll) return;
        poll = setInterval(() => handlers.current.onResync(), pollIntervalMs);
        setStatus("polling");
      },
      onEvent(type, payload) {
        handlers.current.onEvent(type, payload);
      },
    });
    return () => {
      stopPolling();
      unsubscribe();
    };
  }, [typesKey, pollIntervalMs, url]);

  return status;
}
