// Publishes a live-update notice from the app or the worker (Postgres NOTIFY).
import { Pool } from "pg";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/logger";
import { encodeEvent, type AnyEventType, type EventTypeDefinition } from "./eventTypes";
import { REALTIME_CHANNEL } from "./relay";

const holder = globalThis as unknown as { explorehillsRealtimePool?: Pool };

function pool(): Pool {
  if (!holder.explorehillsRealtimePool) {
    holder.explorehillsRealtimePool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 2,
      application_name: "explorehills-realtime-publish",
    });
    // Without a listener, a dropped idle connection ends the whole process. The pool reconnects itself.
    holder.explorehillsRealtimePool.on("error", (error) =>
      logger.warn("the live-update publisher lost a connection", { err: error }),
    );
  }
  return holder.explorehillsRealtimePool;
}

export async function publishEvent<P>(
  type: EventTypeDefinition<P> | AnyEventType,
  payload: P,
): Promise<void> {
  await pool().query("SELECT pg_notify($1, $2)", [REALTIME_CHANNEL, encodeEvent(type, payload)]);
}

export async function closePublisher(): Promise<void> {
  const current = holder.explorehillsRealtimePool;
  holder.explorehillsRealtimePool = undefined;
  await current?.end();
}
