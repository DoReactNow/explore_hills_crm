// The registry of date display styles (Luxon format tokens). Every date shown to a user uses one.
export const DATE_FORMATS = {
  date: "d MMM yyyy", // 1 Jan 2027
  longDate: "cccc, d MMMM yyyy", // Friday, 1 January 2027
  time: "h:mm a", // 12:05 am
  dateTime: "d MMM yyyy, h:mm a", // 1 Jan 2027, 12:05 am
} as const;

export type DateFormatStyle = keyof typeof DATE_FORMATS;
