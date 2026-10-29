// One LISTEN connection per app instance, fanning notices out to the connected streams.
// The app and the worker publish with NOTIFY on the same channel (publish.ts).
import { Client } from "pg";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/logger";
import type { EventMessage } from "./eventTypes";

export const REALTIME_CHANNEL = "explorehills_events";

export interface RelaySubscriber {
  onMessage(message: EventMessage): void;
  /** The relay lost its database connection; the stream should close so the browser reconnects. */
  onClose(): void;
}

interface RelayState {
  client: Client | null;
  connecting: Promise<Client> | null;
  subscribers: Set<RelaySubscriber>;
}

// On globalThis: route bundles would otherwise each get their own copy (see principalResolver.ts).
const holder = globalThis as unknown as { explorehillsRealtimeRelay?: RelayState };
const state = (holder.explorehillsRealtimeRelay ??= {
  client: null,
  connecting: null,
  subscribers: new Set(),
});

function dropConnection(reason: unknown) {
  logger.warn("realtime relay lost its database connection", { err: reason });
  state.client?.removeAllListeners();
  state.client = null;
  state.connecting = null;
  for (const subscriber of [...state.subscribers]) subscriber.onClose();
  state.subscribers.clear();
}

async function connect(): Promise<Client> {
  if (state.client) return state.client;
  state.connecting ??= (async () => {
    const client = new Client({
      connectionString: getEnv().DATABASE_URL,
      application_name: "explorehills-realtime",
    });
    client.on("error", dropConnection);
    client.on("end", () => state.client === client && dropConnection("connection ended"));
    client.on("notification", ({ channel, payload }) => {
      if (channel !== REALTIME_CHANNEL || !payload) return;
      let message: EventMessage;
      try {
        message = JSON.parse(payload) as EventMessage;
      } catch {
        return;
      }
      for (const subscriber of state.subscribers) subscriber.onMessage(message);
    });
    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    state.client = client;
    return client;
  })().catch((error: unknown) => {
    state.connecting = null;
    throw error;
  });
  return state.connecting;
}

/** Resolves once the relay is listening, so no notice sent after this is missed. */
export async function subscribe(subscriber: RelaySubscriber): Promise<() => void> {
  await connect();
  state.subscribers.add(subscriber);
  return () => {
    state.subscribers.delete(subscriber);
  };
}

/** Closes the LISTEN connection (tests and shutdown). */
export async function stopRealtimeRelay(): Promise<void> {
  const client = state.client;
  state.client = null;
  state.connecting = null;
  state.subscribers.clear();
  if (client) {
    client.removeAllListeners();
    await client.end().catch(() => undefined);
  }
}
