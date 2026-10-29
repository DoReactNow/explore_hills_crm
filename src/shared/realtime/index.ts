// Live updates mechanism (Decision 28). No module imports here: modules declare their event types
// in <module>.events.ts and export them; the stream route in src/app assembles them.
export {
  assembleEventTypes,
  defineEventType,
  MAX_EVENT_BYTES,
  type AnyEventType,
  type EventTypeDefinition,
} from "./eventTypes";
export { publishEvent } from "./publish";
