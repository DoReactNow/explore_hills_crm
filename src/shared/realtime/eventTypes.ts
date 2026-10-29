// Live-update event types (Decision 28). An event is a notice, not data: it says what changed and
// carries IDs only; the browser then re-fetches through the normal API, so permission and scope
// checks stay in one place. Every type declares who may receive it; without a filter, nobody does.
import { z } from "zod";
import type { Principal } from "@/shared/rbac/principal";

/** Encoded size limit for one event (Postgres allows about 8 KB per NOTIFY). */
export const MAX_EVENT_BYTES = 4096;

export interface EventTypeDefinition<P = Record<string, string>> {
  name: string;
  payload: z.ZodType<P>;
  /** Same permission and scope rules as the data the event points at. Missing = never delivered. */
  canReceive?: (principal: Principal, payload: P) => boolean | Promise<boolean>;
}

/** Any event type, whatever its payload (see AnyJobDefinition for why this is needed). */
export type AnyEventType = Omit<EventTypeDefinition<unknown>, "canReceive"> & {
  canReceive?: (principal: Principal, payload: never) => boolean | Promise<boolean>;
};

export interface EventMessage {
  type: string;
  payload: unknown;
}

const EVENT_NAME = /^[a-z]+\.[a-zA-Z][a-zA-Z0-9]*$/;

function isIdField(field: z.ZodType): boolean {
  const def = field._zod.def as { type: string; innerType?: z.ZodType };
  if (def.type === "string") return true;
  return def.type === "optional" && !!def.innerType && def.innerType._zod.def.type === "string";
}

export function defineEventType<P extends Record<string, string | undefined>>(
  definition: EventTypeDefinition<P>,
): EventTypeDefinition<P> {
  if (!EVENT_NAME.test(definition.name)) {
    throw new Error(`Event name "${definition.name}" must look like <module>.<eventName>`);
  }
  if (!(definition.payload instanceof z.ZodObject)) {
    throw new Error(`Event ${definition.name}: the payload must be an object of IDs only`);
  }
  for (const [key, field] of Object.entries(
    definition.payload.shape as Record<string, z.ZodType>,
  )) {
    if (!isIdField(field)) {
      throw new Error(
        `Event ${definition.name}: field "${key}" must be a string ID (events carry IDs only)`,
      );
    }
  }
  return Object.freeze({ ...definition });
}

export function assembleEventTypes(
  modules: Record<string, ReadonlyArray<AnyEventType>>,
): Map<string, AnyEventType> {
  const types = new Map<string, AnyEventType>();
  for (const [module, list] of Object.entries(modules)) {
    for (const type of list) {
      if (!type.name.startsWith(`${module}.`)) {
        throw new Error(
          `Event ${type.name} is exported by the ${module} module but is not named ${module}.<event>`,
        );
      }
      if (types.has(type.name)) throw new Error(`Duplicate event name: ${type.name}`);
      types.set(type.name, type);
    }
  }
  return types;
}

/** The NOTIFY payload for an event. Validates it and enforces the size limit. */
export function encodeEvent<P>(type: EventTypeDefinition<P> | AnyEventType, payload: P): string {
  const parsed = type.payload.safeParse(payload);
  if (!parsed.success) throw new TypeError(`Invalid payload for event ${type.name}`);
  const encoded = JSON.stringify({ type: type.name, payload: parsed.data });
  if (Buffer.byteLength(encoded, "utf8") > MAX_EVENT_BYTES) {
    throw new RangeError(
      `Event ${type.name} is larger than ${MAX_EVENT_BYTES} bytes; send IDs only`,
    );
  }
  return encoded;
}

/** Whether `principal` may receive this event. Unknown, unfiltered, invalid or failing = no. */
export async function shouldDeliver(
  types: ReadonlyMap<string, AnyEventType>,
  principal: Principal,
  message: EventMessage,
): Promise<boolean> {
  const type = types.get(message.type);
  if (!type?.canReceive) return false;
  const parsed = type.payload.safeParse(message.payload);
  if (!parsed.success) return false;
  try {
    return (await type.canReceive(principal, parsed.data as never)) === true;
  } catch {
    return false;
  }
}
