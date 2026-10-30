// Business dates: calendar days in the business timezone, handled as "YYYY-MM-DD" strings and
// stored as @db.Date. They are never converted through a local-time JS Date.
import { DateTime } from "luxon";
import { APP_CONFIG } from "@/shared/config/appConfig";
import type { Clock } from "./clock";

/** A calendar day, "YYYY-MM-DD". */
export type BusinessDate = string;

export interface ZoneOption {
  /** IANA zone; defaults to APP_CONFIG.locale.businessTimezone. Overridden only in tests. */
  zone?: string;
}

export const businessZone = (options: ZoneOption = {}) =>
  options.zone ?? APP_CONFIG.locale.businessTimezone;

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(value: string): value is BusinessDate {
  return SHAPE.test(value) && DateTime.fromISO(value, { zone: "utc" }).isValid;
}

export function assertBusinessDate(value: string): BusinessDate {
  if (!isBusinessDate(value)) throw new RangeError(`Not a business date (YYYY-MM-DD): "${value}"`);
  return value;
}

/** The business-timezone calendar day an instant falls on. */
export function toBusinessDate(instant: Date, options: ZoneOption = {}): BusinessDate {
  return DateTime.fromJSDate(instant, { zone: businessZone(options) }).toISODate()!;
}

/** Today in the business timezone, from the injected clock. */
export function todayBusinessDate(clock: Clock, options: ZoneOption = {}): BusinessDate {
  return toBusinessDate(clock.now(), options);
}

/** The value Prisma reads and writes for a @db.Date column: UTC midnight of that day. */
export function businessDateToDbDate(date: BusinessDate): Date {
  return DateTime.fromISO(assertBusinessDate(date), { zone: "utc" }).toJSDate();
}

/** The business date held in a @db.Date value returned by Prisma. */
export function dbDateToBusinessDate(value: Date): BusinessDate {
  return DateTime.fromJSDate(value, { zone: "utc" }).toISODate()!;
}

/**
 * The instant of a wall-clock time ("HH:mm") on a business date, in the business timezone.
 * Used for date-time inputs, which are always interpreted in the business timezone.
 */
export function parseBusinessLocalDateTime(
  date: BusinessDate,
  time: string,
  options: ZoneOption = {},
): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new RangeError(`Not a time of day (HH:mm): "${time}"`);
  const parsed = DateTime.fromISO(`${assertBusinessDate(date)}T${time}`, {
    zone: businessZone(options),
  });
  return parsed.toJSDate();
}

/** Where an instant falls in the business week: its date, weekday (0 = Sunday) and minute of day. */
export function businessMoment(
  instant: Date,
  options: ZoneOption = {},
): { date: BusinessDate; weekday: number; minute: number } {
  const local = DateTime.fromJSDate(instant, { zone: businessZone(options) });
  return {
    date: local.toFormat("yyyy-MM-dd"),
    weekday: local.weekday % 7,
    minute: local.hour * 60 + local.minute,
  };
}

/** The calendar day `days` after a business date (before it, when negative). */
export function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  return DateTime.fromISO(assertBusinessDate(date), { zone: "utc" })
    .plus({ days })
    .toFormat("yyyy-MM-dd");
}

/** The weekday of a business date (0 = Sunday). */
export function businessWeekday(date: BusinessDate): number {
  return DateTime.fromISO(assertBusinessDate(date), { zone: "utc" }).weekday % 7;
}
