// Day ranges for "today", "overdue" and daily buckets. Ranges are half-open: [start, end).
import { DateTime } from "luxon";
import {
  assertBusinessDate,
  businessZone,
  type BusinessDate,
  type ZoneOption,
} from "./businessDate";

export interface InstantRange {
  start: Date;
  /** Exclusive: the start of the next business day. */
  end: Date;
}

/** The UTC range covered by one business day (23 or 25 hours on DST change days). */
export function businessDayRange(date: BusinessDate, options: ZoneOption = {}): InstantRange {
  const start = DateTime.fromISO(assertBusinessDate(date), { zone: businessZone(options) }).startOf(
    "day",
  );
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}
