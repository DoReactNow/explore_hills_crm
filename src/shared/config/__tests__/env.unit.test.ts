import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv, type EnvSource } from "../env";

const validKey = () => randomBytes(32).toString("base64");

function devSource(overrides: EnvSource = {}): EnvSource {
  return {
    APP_ENV: "development",
    APP_HOST: "127.0.0.1",
    APP_PORT: "47213",
    APP_URL: "http://127.0.0.1:47213",
    LOG_LEVEL: "debug",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:54329/explorehills_dev",
    AUTH_SECRET: "dev-only-secret-change-me-0123456789abcdef",
    CREDENTIALS_ENCRYPTION_KEY: validKey(),
    TELEPHONY_PROVIDER: "fake",
    WHATSAPP_GATEWAY: "fake",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: "./storage",
    ...overrides,
  };
}

function prodSource(overrides: EnvSource = {}): EnvSource {
  return devSource({
    APP_ENV: "production",
    APP_HOST: "0.0.0.0",
    APP_URL: "https://crm.example.com",
    LOG_LEVEL: "info",
    DATABASE_URL: "postgresql://user:pass@db.example.com:5432/explorehills?sslmode=require",
    AUTH_SECRET: randomBytes(32).toString("base64"),
    TELEPHONY_PROVIDER: "someprovider",
    WHATSAPP_GATEWAY: "somegateway",
    ...overrides,
  });
}

describe("parseEnv: required values", () => {
  it("throws a clear error naming a missing required value", () => {
    const source = devSource();
    delete source.DATABASE_URL;
    expect(() => parseEnv(source)).toThrow(/DATABASE_URL/);
  });

  it("does not put secret values in the error message", () => {
    const secret = "short-secret";
    expect(() => parseEnv(devSource({ AUTH_SECRET: secret }))).toThrow(/AUTH_SECRET/);
    try {
      parseEnv(devSource({ AUTH_SECRET: secret }));
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("parses a valid development source with typed values", () => {
    const env = parseEnv(devSource());
    expect(env.APP_ENV).toBe("development");
    expect(env.APP_PORT).toBe(47213);
    expect(env.databaseName).toBe("explorehills_dev");
  });
});

describe("parseEnv: environment and database guards", () => {
  it("refuses APP_ENV=test with a database not ending in _test", () => {
    expect(() => parseEnv(devSource({ APP_ENV: "test" }))).toThrow(/refusing to run/i);
  });

  it("accepts APP_ENV=test with a _test database", () => {
    const env = parseEnv(
      devSource({
        APP_ENV: "test",
        DATABASE_URL: "postgresql://user:pass@127.0.0.1:54329/explorehills_test",
      }),
    );
    expect(env.databaseName).toBe("explorehills_test");
  });

  it("refuses APP_ENV=production with a database ending in _test", () => {
    const source = prodSource({
      DATABASE_URL: "postgresql://user:pass@db.example.com:5432/explorehills_test",
    });
    expect(() => parseEnv(source)).toThrow(/refusing to run/i);
  });

  it("refuses the dev placeholder AUTH_SECRET in production", () => {
    const source = prodSource({ AUTH_SECRET: "dev-only-secret-change-me-0123456789abcdef" });
    expect(() => parseEnv(source)).toThrow(/AUTH_SECRET/);
  });

  it("accepts a valid production source", () => {
    expect(parseEnv(prodSource()).APP_ENV).toBe("production");
  });
});

describe("parseEnv: integrations and encryption key", () => {
  it("requires STORAGE_LOCAL_DIR when STORAGE_DRIVER=local", () => {
    const source = devSource();
    delete source.STORAGE_LOCAL_DIR;
    expect(() => parseEnv(source)).toThrow(/STORAGE_LOCAL_DIR/);
  });

  it("rejects an unknown STORAGE_DRIVER", () => {
    expect(() => parseEnv(devSource({ STORAGE_DRIVER: "floppy" }))).toThrow(/STORAGE_DRIVER/);
  });

  it("requires the S3 settings when STORAGE_DRIVER=s3", () => {
    expect(() => parseEnv(devSource({ STORAGE_DRIVER: "s3" }))).toThrow(/STORAGE_S3_BUCKET/);
  });

  it("rejects a malformed TELEPHONY_PROVIDER or WHATSAPP_GATEWAY key", () => {
    expect(() => parseEnv(devSource({ TELEPHONY_PROVIDER: "Not A Key" }))).toThrow(
      /TELEPHONY_PROVIDER/,
    );
    expect(() => parseEnv(devSource({ WHATSAPP_GATEWAY: "" }))).toThrow(/WHATSAPP_GATEWAY/);
  });

  it("rejects an encryption key that is not 32 bytes of base64", () => {
    const tooShort = Buffer.from("too-short").toString("base64");
    expect(() => parseEnv(devSource({ CREDENTIALS_ENCRYPTION_KEY: tooShort }))).toThrow(
      /CREDENTIALS_ENCRYPTION_KEY/,
    );
    expect(() => parseEnv(devSource({ CREDENTIALS_ENCRYPTION_KEY: "not base64!!" }))).toThrow(
      /CREDENTIALS_ENCRYPTION_KEY/,
    );
  });

  it("refuses fake telephony and WhatsApp in production", () => {
    expect(() => parseEnv(prodSource({ TELEPHONY_PROVIDER: "fake" }))).toThrow(
      /TELEPHONY_PROVIDER/,
    );
    expect(() => parseEnv(prodSource({ WHATSAPP_GATEWAY: "fake" }))).toThrow(/WHATSAPP_GATEWAY/);
  });

  it("refuses the dev placeholder encryption key in production", () => {
    const devKey = Buffer.from("dev-only-key-change-me-000000000").toString("base64");
    expect(() => parseEnv(prodSource({ CREDENTIALS_ENCRYPTION_KEY: devKey }))).toThrow(
      /CREDENTIALS_ENCRYPTION_KEY/,
    );
  });
});

describe("example env files", () => {
  const read = (file: string): EnvSource => parse(readFileSync(file, "utf8"));

  it(".env.example parses", () => {
    expect(parseEnv(read(".env.example")).APP_ENV).toBe("development");
  });

  it(".env.test.example parses", () => {
    expect(parseEnv(read(".env.test.example")).APP_ENV).toBe("test");
  });

  it(".env.production.example parses once its placeholders are replaced", () => {
    const replacements: EnvSource = {
      APP_URL: "https://crm.example.com",
      DATABASE_URL: "postgresql://user:pass@db.example.com:5432/explorehills?sslmode=require",
      AUTH_SECRET: randomBytes(32).toString("base64"),
      CREDENTIALS_ENCRYPTION_KEY: validKey(),
      TELEPHONY_PROVIDER: "someprovider",
      WHATSAPP_GATEWAY: "somegateway",
    };
    const source = read(".env.production.example");
    for (const [name, value] of Object.entries(source)) {
      if (value?.includes("<")) {
        expect(replacements, `no replacement for ${name}`).toHaveProperty(name);
        source[name] = replacements[name];
      }
    }
    expect(parseEnv(source).APP_ENV).toBe("production");
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("validates lazily on first call, not at import", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const mod = await import("../env");
    expect(() => mod.getEnv()).toThrow(/DATABASE_URL/);
  });
});
