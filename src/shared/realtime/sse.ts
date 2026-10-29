// Turns relay notices into a Server-Sent Events response for one signed-in user.
import type { Principal } from "@/shared/rbac/principal";
import { shouldDeliver, type AnyEventType } from "./eventTypes";
import { subscribe } from "./relay";

/** Comments every ~25 s keep proxies and browsers from closing an idle stream. */
export const KEEP_ALIVE_MS = 25_000;
/** Tells EventSource how long to wait before reconnecting. */
const RETRY_MS = 3_000;

export function createEventStream({
  principal,
  types,
  signal,
  keepAliveMs = KEEP_ALIVE_MS,
}: {
  principal: Principal;
  types: ReadonlyMap<string, AnyEventType>;
  signal: AbortSignal;
  keepAliveMs?: number;
}): Response {
  const encoder = new TextEncoder();
  let close: () => void = () => undefined;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      // Deliver in order even though each filter may be async.
      let queue = Promise.resolve();

      send(`retry: ${RETRY_MS}\n\n`);
      const unsubscribe = await subscribe({
        onMessage(message) {
          queue = queue.then(async () => {
            if (await shouldDeliver(types, principal, message)) {
              send(`event: ${message.type}\ndata: ${JSON.stringify(message.payload)}\n\n`);
            }
          });
        },
        onClose: () => close(),
      });
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), keepAliveMs);

      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      signal.addEventListener("abort", () => close(), { once: true });
      if (signal.aborted) close();
      else send(": connected\n\n");
    },
    cancel() {
      close();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // nginx: do not buffer this response
    },
  });
}
