// When an SLA falls due, counting only working time (Decision 63). Pure: everything is passed in.
import {
  addBusinessDays,
  businessMoment,
  businessWeekday,
  instantFromEpochMs,
  parseBusinessLocalDateTime,
  type BusinessDate,
} from "@/shared/time";

export interface WorkingCalendar {
  /** 0 is Sunday. */
  days: readonly number[];
  from: string;
  to: string;
  holidays: readonly BusinessDate[];
}

const MS_IN_MINUTE = 60_000;
/** Far enough that a calendar with no working days can't loop for ever. */
const MAX_DAYS = 400;

export const isWorkingDay = (date: BusinessDate, calendar: WorkingCalendar) =>
  calendar.days.includes(businessWeekday(date)) && !calendar.holidays.includes(date);

/** The instant `minutes` of working time after `start`, or null if the calendar has none. */
export function addWorkingMinutes(
  start: Date,
  minutes: number,
  calendar: WorkingCalendar,
): Date | null {
  let remaining = minutes * MS_IN_MINUTE;
  let day = businessMoment(start).date;
  for (let i = 0; i < MAX_DAYS; i += 1) {
    if (isWorkingDay(day, calendar)) {
      const open = parseBusinessLocalDateTime(day, calendar.from).getTime();
      const close = parseBusinessLocalDateTime(day, calendar.to).getTime();
      const from = Math.max(open, start.getTime());
      if (close > from) {
        if (close - from >= remaining) return instantFromEpochMs(from + remaining);
        remaining -= close - from;
      }
    }
    day = addBusinessDays(day, 1);
  }
  return null;
}
