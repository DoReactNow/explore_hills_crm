// Instants: moments in time, stored as timestamptz and sent as ISO-8601 UTC strings ending in Z.
import { DateTime } from "luxon";

/** Parses an ISO-8601 instant. A zone (Z or an offset) is required, so nothing is read as local time. */
export function parseInstant(value: string): Date {
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(value)) {
    throw new RangeError(`Not an ISO-8601 instant with a zone: "${value}"`);
  }
  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid) throw new RangeError(`Not an ISO-8601 instant with a zone: "${value}"`);
  return parsed.toJSDate();
}

/** The API form of an instant: ISO-8601 UTC with milliseconds, e.g. 2027-01-01T00:00:00.000Z. */
export function toIsoInstant(instant: Date): string {
  return instant.toISOString();
}
