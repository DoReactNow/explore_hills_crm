// Display formatting with an explicit zone and locale: never the machine's or browser's,
// which also keeps server and client rendering identical.
import { DateTime } from "luxon";
import { APP_CONFIG } from "@/shared/config/appConfig";
import {
  addBusinessDays,
  assertBusinessDate,
  businessZone,
  toBusinessDate,
  todayBusinessDate,
  type BusinessDate,
  type ZoneOption,
} from "./businessDate";
import type { Clock } from "./clock";
import { DATE_FORMATS, type DateFormatStyle } from "./formats";

const locale = () => APP_CONFIG.locale.locale;

/** Formats an instant as seen in the business timezone. */
export function formatInstant(
  instant: Date,
  style: DateFormatStyle,
  options: ZoneOption = {},
): string {
  return DateTime.fromJSDate(instant, { zone: businessZone(options) })
    .setLocale(locale())
    .toFormat(DATE_FORMATS[style]);
}

/** Formats a calendar day. No timezone conversion happens: the day is the day. */
export function formatBusinessDate(
  date: BusinessDate,
  style: Extract<DateFormatStyle, "date" | "longDate">,
): string {
  return DateTime.fromISO(assertBusinessDate(date), { zone: "utc" })
    .setLocale(locale())
    .toFormat(DATE_FORMATS[style]);
}

/**
 * How recent lists show a moment (owner's design): the time if today, "Yesterday", the day and month
 * this year, or the full date.
 */
export function formatRecent(instant: Date, clock: Clock, options: ZoneOption = {}): string {
  const day = toBusinessDate(instant, options);
  const today = todayBusinessDate(clock, options);
  if (day === today) return formatInstant(instant, "time", options);
  if (day === addBusinessDays(today, -1)) return "Yesterday";
  if (day.slice(0, 4) === today.slice(0, 4)) return formatInstant(instant, "dayMonth", options);
  return formatInstant(instant, "date", options);
}
