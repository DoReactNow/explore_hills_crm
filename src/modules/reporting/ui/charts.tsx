// Small charts with one series. Each mark's value shows on hover, and a screen reader gets it as text.
import { businessWeekday } from "@/shared/time";
import styles from "./reporting.module.css";

export function DayBars({
  label,
  rows,
  dayLabel,
}: {
  label: string;
  rows: ReadonlyArray<{ day: string; count: number }>;
  dayLabel: (day: string) => string;
}) {
  const top = Math.max(1, ...rows.map((row) => row.count));
  const description = rows.map((row) => `${dayLabel(row.day)}: ${row.count}`).join(", ");
  return (
    <>
      <div className={styles.bars} role="img" aria-label={`${label}. ${description}`}>
        {rows.map((row) =>
          row.count === 0 ? (
            <span key={row.day} className={styles.barEmpty} title={`${dayLabel(row.day)}: 0`} />
          ) : (
            <span
              key={row.day}
              className={styles.bar}
              style={{ height: `${(row.count / top) * 100}%` }}
              title={`${dayLabel(row.day)}: ${row.count}`}
            />
          ),
        )}
      </div>
      {rows.length > 0 ? (
        <div className={styles.axis}>
          <span>{dayLabel(rows[0].day)}</span>
          <span>{dayLabel(rows[rows.length - 1].day)}</span>
        </div>
      ) : null}
    </>
  );
}

export function RowBars({ rows }: { rows: ReadonlyArray<{ label: string; count: number }> }) {
  const top = Math.max(1, ...rows.map((row) => row.count));
  return (
    <>
      {rows.map((row) => (
        <div key={row.label} className={styles.hRow} title={`${row.label}: ${row.count}`}>
          <span>{row.label}</span>
          <span className={styles.hTrack}>
            <span className={styles.hFill} style={{ width: `${(row.count / top) * 100}%` }} />
          </span>
          <span className={styles.hValue}>{row.count}</span>
        </div>
      ))}
    </>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayOf = (day: string) => WEEKDAYS[businessWeekday(day)] ?? day;

/** A week of daily counts as labelled columns (Dash-Agent design): value above, weekday below. */
export function DayColumns({
  label,
  rows,
}: {
  label: string;
  rows: ReadonlyArray<{ day: string; count: number }>;
}) {
  const top = Math.max(1, ...rows.map((row) => row.count));
  const description = rows.map((row) => `${weekdayOf(row.day)}: ${row.count}`).join(", ");
  return (
    <div className={styles.columnsChart} role="img" aria-label={`${label}. ${description}`}>
      {rows.map((row, index) => (
        <div key={row.day} className={styles.column} title={`${weekdayOf(row.day)}: ${row.count}`}>
          <span className={styles.columnValue}>{row.count}</span>
          <span className={styles.columnTrack}>
            <span
              className={index === rows.length - 1 ? styles.columnFillNow : styles.columnFill}
              style={{ height: `${Math.max(row.count ? 4 : 0, (row.count / top) * 100)}%` }}
            />
          </span>
          <span className={styles.columnDay}>{weekdayOf(row.day)}</span>
        </div>
      ))}
    </div>
  );
}
