// The only file that reads process.env (ESLint enforces this).
// Values are validated lazily on the first getEnv() call, never at import, so `next build`
// needs no database or secrets. Error messages name the variable but never echo its value.
import { z } from "zod";

export type EnvSource = Record<string, string | undefined>;

const PROVIDER_KEY = /^[a-z][a-z0-9-]*$/;
// Markers carried by the committed dev/test placeholder secrets; refused in production.
const PLACEHOLDER_MARKERS = ["dev-only", "test-only", "change-me"];

const isPlaceholder = (value: string) =>
  PLACEHOLDER_MARKERS.some((marker) => value.toLowerCase().includes(marker));

const decodeKey = (value: string): Buffer | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  return Buffer.from(value, "base64");
};

const providerKey = (label: string) =>
  z.string().regex(PROVIDER_KEY, `${label} must be a lowercase adapter key such as "fake"`);

const baseSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"], {
    error: "APP_ENV must be development, test or production",
  }),
  APP_HOST: z.string().min(1, "APP_HOST is required"),
  APP_PORT: z.coerce
    .number({ error: "APP_PORT must be a number" })
    .int()
    .min(1)
    .max(65535, "APP_PORT must be between 1 and 65535"),
  APP_URL: z.url({ error: "APP_URL must be a full URL" }),
  /** Proxies in front of the app that add to X-Forwarded-For (Decision 49). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z
    .enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"], {
      error: "LOG_LEVEL must be silent, fatal, error, warn, info, debug or trace",
    })
    .default("info"),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .regex(
      /^postgres(ql)?:\/\/[^/]+\/[^/?]+/,
      "DATABASE_URL must be a postgresql:// URL with a database name",
    ),
  AUTH_SECRET: z
    .string({ error: "AUTH_SECRET is required" })
    .min(32, "AUTH_SECRET must be at least 32 characters"),
  CREDENTIALS_ENCRYPTION_KEY: z
    .string({ error: "CREDENTIALS_ENCRYPTION_KEY is required" })
    .refine((value) => decodeKey(value)?.length === 32, {
      error: "CREDENTIALS_ENCRYPTION_KEY must be 32 random bytes, base64-encoded",
    }),
  TELEPHONY_PROVIDER: providerKey("TELEPHONY_PROVIDER"),
  WHATSAPP_GATEWAY: providerKey("WHATSAPP_GATEWAY"),
  STORAGE_DRIVER: z.enum(["local", "s3"], { error: "STORAGE_DRIVER must be local or s3" }),
  STORAGE_LOCAL_DIR: z.string().min(1).optional(),
  STORAGE_S3_ENDPOINT: z.url().optional(),
  STORAGE_S3_REGION: z.string().min(1).optional(),
  STORAGE_S3_BUCKET: z.string().min(1).optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
  FFMPEG_PATH: z.string().min(1).optional(),
});

const S3_REQUIRED = [
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_REGION",
  "STORAGE_S3_BUCKET",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
] as const;

const envSchema = baseSchema.superRefine((env, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });

  if (env.STORAGE_DRIVER === "local" && !env.STORAGE_LOCAL_DIR) {
    issue("STORAGE_LOCAL_DIR", "STORAGE_LOCAL_DIR is required when STORAGE_DRIVER=local");
  }
  if (env.STORAGE_DRIVER === "s3") {
    for (const name of S3_REQUIRED) {
      if (!env[name]) issue(name, `${name} is required when STORAGE_DRIVER=s3`);
    }
  }

  if (env.APP_ENV === "production") {
    if (isPlaceholder(env.AUTH_SECRET)) {
      issue("AUTH_SECRET", "AUTH_SECRET is a development placeholder; generate a real secret");
    }
    const key = decodeKey(env.CREDENTIALS_ENCRYPTION_KEY);
    if (key && isPlaceholder(key.toString("latin1"))) {
      issue(
        "CREDENTIALS_ENCRYPTION_KEY",
        "CREDENTIALS_ENCRYPTION_KEY is a development placeholder; generate a real key",
      );
    }
    if (env.TELEPHONY_PROVIDER === "fake") {
      issue("TELEPHONY_PROVIDER", 'TELEPHONY_PROVIDER "fake" is not allowed in production');
    }
    if (env.WHATSAPP_GATEWAY === "fake") {
      issue("WHATSAPP_GATEWAY", 'WHATSAPP_GATEWAY "fake" is not allowed in production');
    }
  }
});

export type Env = z.infer<typeof baseSchema> & { databaseName: string };

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** Validates an environment source. Exported for tests; app code uses getEnv(). */
export function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const name = String(issue.path[0] ?? "environment");
      // Zod's own wording can include the received value; keep only our messages.
      const message = issue.message.includes(name)
        ? issue.message
        : `${name} is missing or invalid`;
      return `  - ${message}`;
    });
    throw new EnvError(`Invalid environment configuration:\n${lines.join("\n")}`);
  }

  const env = { ...result.data, databaseName: databaseNameOf(result.data.DATABASE_URL) };
  const isTestDb = env.databaseName.endsWith("_test");
  if (env.APP_ENV === "test" && !isTestDb) {
    throw new EnvError(
      `Refusing to run: APP_ENV=test needs a database whose name ends in _test (got "${env.databaseName}").`,
    );
  }
  if (env.APP_ENV === "production" && isTestDb) {
    throw new EnvError(
      `Refusing to run: APP_ENV=production cannot use a test database (got "${env.databaseName}").`,
    );
  }
  return Object.freeze(env);
}

let cached: Env | undefined;

/** The validated environment. Validated on first use, then cached for the process. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
