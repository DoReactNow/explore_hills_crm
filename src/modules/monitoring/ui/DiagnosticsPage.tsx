"use client";

// Diagnostics for operators (system:view-diagnostics): whether everything is running, what has gone
// wrong and how much room is left. It reads guarded APIs, so a refusal is the usual friendly message.
import { useCallback, useEffect, useState } from "react";
import type { Diagnostics } from "@/modules/system";
import { apiRequest, type ApiResult } from "@/shared/api/client";
import { useLiveEvents } from "@/shared/realtime/useLiveEvents";
import { formatInstant, parseInstant } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import type { MonitoringView } from "../monitoring.types";
import styles from "./diagnostics.module.css";

const when = (iso: string) => formatInstant(parseInstant(iso), "dateTime");
const GB = 1024 * 1024 * 1024;
const size = (bytes: number) =>
  bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / (1024 * 1024))} MB`;

function Status({ label, good, value }: { label: string; good: boolean; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={good ? styles.good : styles.bad}>{value}</span>
    </div>
  );
}

export function DiagnosticsPage() {
  const [health, setHealth] = useState<ApiResult<Diagnostics> | null>(null);
  const [view, setView] = useState<ApiResult<MonitoringView> | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    apiRequest<Diagnostics>("/api/diagnostics", { signal }).then((next) => {
      if (!signal.aborted) setHealth(next);
    });
    apiRequest<MonitoringView>("/api/monitoring", { signal }).then((next) => {
      if (!signal.aborted) setView(next);
    });
    return () => controller.abort();
  }, [version]);

  // The worker announces when it starts or stops; re-fetch instead of waiting for a refresh.
  const live = useLiveEvents({
    types: ["system.workerStatusChanged"],
    onEvent: reload,
    onResync: reload,
  });

  const openAlerts = view?.ok ? view.data.alerts.filter((alert) => !alert.resolvedAt) : [];
  const pastAlerts = view?.ok ? view.data.alerts.filter((alert) => alert.resolvedAt) : [];

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Diagnostics</h1>
      {health === null ? <p>Loading…</p> : null}
      {health && !health.ok ? <ErrorMessage error={health.error} /> : null}
      {health?.ok ? (
        <section className={styles.stats} aria-label="Status">
          <Status
            label="Status"
            good={health.data.status === "ok"}
            value={`Status: ${health.data.status}`}
          />
          <Status
            label="Database"
            good={health.data.database === "up"}
            value={`Database: ${health.data.database}`}
          />
          <Status
            label="Background worker"
            good={health.data.worker.state === "up"}
            value={`Worker: ${health.data.worker.state}`}
          />
          <Status label="Live updates" good={live === "live"} value={`Live updates: ${live}`} />
          <p className={styles.muted}>
            Version {health.data.version}. Server time {when(health.data.time)}.
            {health.data.worker.lastBeatAt
              ? ` Last heartbeat ${when(health.data.worker.lastBeatAt)}.`
              : ""}
          </p>
        </section>
      ) : null}

      {/* Both requests refuse together, so one message is enough. */}
      {view && !view.ok && health?.ok ? <ErrorMessage error={view.error} /> : null}
      {view?.ok ? (
        <>
          <section className={styles.card}>
            <h2 className={styles.heading}>Alerts</h2>
            {openAlerts.length === 0 ? <p className={styles.muted}>No open alerts.</p> : null}
            <ul className={styles.list}>
              {openAlerts.map((alert) => (
                <li key={alert.id} className={styles.alert}>
                  <strong>{alert.title}</strong>
                  <span>{alert.detail}</span>
                  <span className={styles.muted}>Since {when(alert.openedAt)}</span>
                </li>
              ))}
            </ul>
            {pastAlerts.length > 0 ? (
              <>
                <h3 className={styles.subheading}>Cleared in the last 7 days</h3>
                <ul className={styles.list}>
                  {pastAlerts.map((alert) => (
                    <li key={alert.id} className={styles.past}>
                      <span>{alert.title}</span>
                      <span className={styles.muted}>
                        {when(alert.openedAt)} to {when(alert.resolvedAt as string)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className={styles.card}>
            <h2 className={styles.heading}>Room left</h2>
            <dl className={styles.facts}>
              <div>
                <dt>Disk free</dt>
                <dd>
                  {view.data.capacity.diskFreeBytes === null ||
                  view.data.capacity.diskTotalBytes === null
                    ? "Can't be read"
                    : `${size(view.data.capacity.diskFreeBytes)} of ${size(view.data.capacity.diskTotalBytes)}`}
                </dd>
              </div>
              <div>
                <dt>Database size</dt>
                <dd>{size(view.data.capacity.databaseBytes)}</dd>
              </div>
              <div>
                <dt>Database connections</dt>
                <dd>
                  {view.data.capacity.connections} of {view.data.capacity.maxConnections}
                </dd>
              </div>
              <div>
                <dt>Live screens on this server</dt>
                <dd>{view.data.capacity.liveStreams}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.card}>
            <h2 className={styles.heading}>Background jobs</h2>
            {view.data.queues.length === 0 ? (
              <p className={styles.muted}>Nothing waiting or failed.</p>
            ) : (
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Background jobs"
              >
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Job</th>
                      <th scope="col">Waiting</th>
                      <th scope="col">Running</th>
                      <th scope="col">Failed today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.data.queues.map((queue) => (
                      <tr key={queue.name}>
                        <td>{queue.name}</td>
                        <td>{queue.waiting}</td>
                        <td>{queue.active}</td>
                        <td>{queue.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.heading}>Errors in the last 7 days</h2>
            {view.data.errors.length === 0 ? (
              <p className={styles.muted}>No errors recorded.</p>
            ) : (
              <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Errors">
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">What happened</th>
                      <th scope="col">Where</th>
                      <th scope="col">Times</th>
                      <th scope="col">Last seen</th>
                      <th scope="col">Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.data.errors.map((error) => (
                      <tr key={error.fingerprint}>
                        <td className={styles.message}>{error.message}</td>
                        <td>{error.source === "worker" ? "Worker" : "App"}</td>
                        <td>{error.count}</td>
                        <td>{when(error.lastSeenAt)}</td>
                        <td className={styles.code}>{error.lastRequestId ?? "None"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
