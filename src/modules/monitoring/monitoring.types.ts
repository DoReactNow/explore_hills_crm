// What monitoring watches, and when it speaks up (Decision 67).
export const ALERTS = {
  worker_down: "The background worker has stopped",
  jobs_failed: "Background jobs have failed",
  jobs_stuck: "Background jobs are stuck",
  disk_low: "The server is running out of disk space",
  errors_spike: "The app is reporting many errors",
  backup_stale: "Off-server backups have stopped",
  certificate_expiring: "The HTTPS certificate is about to expire",
} as const;
export type AlertCode = keyof typeof ALERTS;

export const CHECK_EVERY_MS = 60_000;
/** Longer than a normal restart, so a deploy doesn't raise an alert. */
export const WORKER_ALERT_AFTER_SECONDS = 180;
export const FAILED_LOOK_BACK_HOURS = 1;
export const STUCK_GRACE_SECONDS = 300;
export const WAITING_TOO_LONG_HOURS = 1;
export const DISK_MIN_FREE_RATIO = 0.1;
export const DISK_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
export const ERROR_SPIKE_PER_HOUR = 50;
export const BACKUP_STALE_HOURS = 36;
/** scripts/server/backup-offsite.sh touches this file in the storage folder after each success. */
export const BACKUP_STAMP_FILE = ".offsite-backup-ok";
export const CERTIFICATE_WARNING_DAYS = 14;
export const ERROR_RETENTION_DAYS = 30;
export const ALERT_RETENTION_DAYS = 90;

export interface MonitoringView {
  alerts: Array<{
    id: string;
    code: AlertCode;
    title: string;
    detail: string;
    openedAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
  }>;
  errors: Array<{
    fingerprint: string;
    name: string;
    message: string;
    source: string;
    count: number;
    lastSeenAt: string;
    lastRequestId: string | null;
  }>;
  queues: Array<{ name: string; waiting: number; active: number; failed: number }>;
  capacity: {
    connections: number;
    maxConnections: number;
    databaseBytes: number;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
    liveStreams: number;
  };
}
