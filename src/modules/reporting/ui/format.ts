// How report figures read on screen.
import { formatBusinessDate } from "@/shared/time";

export const rupees = (amount: string | number) =>
  `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(amount))}`;
export const minutesLabel = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)} min`;
export const dayLabel = (day: string) => formatBusinessDate(day, "date").replace(/ \d{4}$/, "");
export const talkLabel = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};
