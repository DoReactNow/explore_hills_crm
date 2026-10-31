// Structured JSON logs (project_data.md Section 8). Secrets are redacted by key name at any
// depth; errors keep name, message and stack. Technical detail lives here, never in responses.
import { getEnv } from "@/shared/config/env";
import { systemClock, type Clock } from "@/shared/time/clock";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LoggerLevel = LogLevel | "silent";

export type LogFields = Record<string, unknown>;
export type LogRecord = LogFields & { time: string; level: LogLevel; msg: string };

export interface Logger {
  trace(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  fatal(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level: LoggerLevel | (() => LoggerLevel);
  sink?: (record: LogRecord) => void;
  clock?: Clock;
  bindings?: LogFields;
}

const REDACTED = "[redacted]";
const SECRET_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|encrypted|credential|database_?url|dsn/i;

// Personal data has no place in logs either (database_schema.md Section 7). Each entry is a field
// name from the personal data map, tested in logger.unit.test.ts.
export const PERSONAL_FIELDS = [
  "phone",
  "phoneE164",
  "customerPhone",
  "customerPhoneE164",
  "agentPhone",
  "waId",
  "email",
  "name",
  "profileName",
  "contactName",
  "customerName",
  "body",
  "rawBody",
  "payload",
  "note",
  "notes",
  "outcomeNotes",
  "routingNote",
  "reason",
  "lostReason",
  "destination",
  "travelStartDate",
  "travelEndDate",
  "travellerCount",
  "budgetAmount",
  "customFields",
  "sourceDetail",
  "templateVariables",
  "mediaFilename",
  "title",
  "ip",
  "userAgent",
] as const;
const PERSONAL_KEY = new Set<string>(PERSONAL_FIELDS.map((field) => field.toLowerCase()));

const isSensitiveKey = (key: string) => SECRET_KEY.test(key) || PERSONAL_KEY.has(key.toLowerCase());

const EMAIL_TEXT = /[^@\s"'<>]+@[^@\s"'<>]+\.[^@\s"'<>]+/g;
const PHONE_TEXT = /(?<![\w:.-])\+?\d[\d\s()-]{8,}\d(?![\w:.-])/g;

/** Text can carry a number or address too, such as a provider's error message. */
function maskText(text: string): string {
  return text
    .replace(EMAIL_TEXT, REDACTED)
    .replace(PHONE_TEXT, (match) => (match.replace(/\D/g, "").length >= 10 ? REDACTED : match));
}

function sanitise(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskText(value.message),
      stack: value.stack && maskText(value.stack),
    };
  }
  if (typeof value === "string") return maskText(value);
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitise(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED : sanitise(item, depth + 1),
    ]),
  );
}

const defaultSink = (record: LogRecord) => {
  const line = JSON.stringify(record);
  if (LOG_LEVELS.indexOf(record.level) >= LOG_LEVELS.indexOf("warn")) console.error(line);
  else console.log(line);
};

export function createLogger(options: LoggerOptions): Logger {
  const { sink = defaultSink, clock = systemClock, bindings = {} } = options;
  const currentLevel =
    typeof options.level === "function" ? options.level : () => options.level as LoggerLevel;

  const write = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    const threshold = currentLevel();
    if (threshold === "silent" || LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(threshold)) return;
    const extra = sanitise({ ...bindings, ...fields }) as LogFields;
    sink({ time: clock.now().toISOString(), level, msg, ...extra });
  };

  return {
    trace: (msg, fields) => write("trace", msg, fields),
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    fatal: (msg, fields) => write("fatal", msg, fields),
    child: (more) => createLogger({ ...options, bindings: { ...bindings, ...more } }),
  };
}

/** LOG_LEVEL from the environment; "info" if the environment is not valid yet. */
function levelFromEnv(): LoggerLevel {
  try {
    return getEnv().LOG_LEVEL;
  } catch {
    return "info";
  }
}

/** The process-wide logger. Use `logger.child({ requestId })` inside a request. */
export const logger: Logger = createLogger({ level: levelFromEnv });
