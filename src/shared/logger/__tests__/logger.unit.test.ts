import { describe, expect, it } from "vitest";
import { createTestClock } from "@/shared/time";
import { createLogger, type LogRecord } from "../logger";

function capture(level: Parameters<typeof createLogger>[0]["level"]) {
  const records: LogRecord[] = [];
  const clock = createTestClock("2026-10-30T10:00:00.000Z");
  const logger = createLogger({ level, sink: (record) => records.push(record), clock });
  return { logger, records };
}

describe("logger", () => {
  it("writes structured records with time, level and message", () => {
    const { logger, records } = capture("info");
    logger.info("server started", { port: 47213 });
    expect(records).toEqual([
      { time: "2026-10-30T10:00:00.000Z", level: "info", msg: "server started", port: 47213 },
    ]);
  });

  it("drops records below the configured level and writes nothing when silent", () => {
    const warnOnly = capture("warn");
    warnOnly.logger.info("ignored");
    warnOnly.logger.error("kept");
    expect(warnOnly.records.map((r) => r.msg)).toEqual(["kept"]);

    const silent = capture("silent");
    silent.logger.fatal("nothing");
    expect(silent.records).toEqual([]);
  });

  it("carries bound fields such as requestId into child loggers", () => {
    const { logger, records } = capture("debug");
    logger.child({ requestId: "req-1" }).debug("handled");
    expect(records[0]).toMatchObject({ requestId: "req-1", msg: "handled" });
  });

  it("redacts secrets at any depth", () => {
    const { logger, records } = capture("info");
    logger.info("login", {
      password: "hunter2",
      user: { email: "a@b.c", apiKey: "k", nested: { authorization: "Bearer x" } },
      secretEncrypted: "zzz",
      DATABASE_URL: "postgresql://u:p@h/db",
    });
    const text = JSON.stringify(records[0]);
    for (const secret of ["hunter2", '"k"', "Bearer x", "zzz", "u:p@h"]) {
      expect(text).not.toContain(secret);
    }
    expect(records[0]).toMatchObject({ password: "[redacted]", user: { email: "a@b.c" } });
  });

  it("serialises errors with name, message and stack", () => {
    const { logger, records } = capture("error");
    logger.error("failed", { err: new TypeError("bad thing") });
    expect(records[0].err).toMatchObject({ name: "TypeError", message: "bad thing" });
    expect(String((records[0].err as { stack: string }).stack)).toContain("TypeError");
  });
});
