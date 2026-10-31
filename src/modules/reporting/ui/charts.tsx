// Small charts with one series. Each mark's value shows on hover, and a screen reader gets it as text.
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
