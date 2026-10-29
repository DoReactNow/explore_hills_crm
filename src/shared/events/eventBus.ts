// Typed in-process publish/subscribe between modules (project_data.md Section 4.2).
// Payloads must be plain serialisable data, so the bus can later be swapped for a broker.
// Every subscriber gets its own copy, and one failing subscriber never stops the others.

type Handler<P> = (payload: P) => void | Promise<void>;

export interface EventBusOptions {
  onHandlerError?: (eventName: string, error: unknown) => void;
}

export interface EventBus<Events extends Record<string, unknown>> {
  subscribe<N extends keyof Events & string>(name: N, handler: Handler<Events[N]>): () => void;
  publish<N extends keyof Events & string>(name: N, payload: Events[N]): Promise<void>;
}

function isPlainData(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isPlainData(item, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every((item) => isPlainData(item, depth + 1));
  }
  return false;
}

export function createEventBus<Events extends Record<string, unknown>>(
  options: EventBusOptions = {},
): EventBus<Events> {
  const handlers = new Map<string, Set<Handler<never>>>();

  return {
    subscribe(name, handler) {
      const set = handlers.get(name) ?? new Set();
      set.add(handler as Handler<never>);
      handlers.set(name, set);
      return () => {
        set.delete(handler as Handler<never>);
      };
    },

    async publish(name, payload) {
      if (!isPlainData(payload)) {
        throw new TypeError(`Event "${name}" payload must be plain serialisable data`);
      }
      const encoded = JSON.stringify(payload);
      const results = await Promise.allSettled(
        [...(handlers.get(name) ?? [])].map(async (handler) =>
          (handler as Handler<Events[typeof name]>)(JSON.parse(encoded)),
        ),
      );
      for (const result of results) {
        if (result.status === "rejected") options.onHandlerError?.(name, result.reason);
      }
    },
  };
}
