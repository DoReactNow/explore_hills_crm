// Display formatting with an explicit zone and locale: never the machine's or browser's,
// which also keeps server and client rendering identical.
import { DateTime } from "luxon";
import { APP_CONFIG } from "@/shared/config/appConfig";
import {
  assertBusinessDate,
  businessZone,
  type BusinessDate,
  type ZoneOption,
} from "./businessDate";
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
