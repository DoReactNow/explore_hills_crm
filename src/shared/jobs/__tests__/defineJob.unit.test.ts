import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineJob, parsePayload } from "../defineJob";

const handler = async () => undefined;

describe("defineJob()", () => {
  it("returns the definition with its name, schema, retry policy and handler", () => {
    const job = defineJob({
      name: "system.example",
      payload: z.object({ id: z.string() }),
      retry: { limit: 3, delaySeconds: 30, backoff: true },
      handler,
    });
    expect(job).toMatchObject({
      name: "system.example",
      retry: { limit: 3, delaySeconds: 30, backoff: true },
    });
  });

  it("requires a Zod payload schema", () => {
    expect(() =>
      defineJob({
        name: "system.x",
        payload: undefined as never,
        retry: { limit: 1, delaySeconds: 1, backoff: false },
        handler,
      }),
    ).toThrow(/payload schema/);
  });

  it("requires a retry policy with sensible numbers", () => {
    const payload = z.object({});
    expect(() =>
      defineJob({ name: "system.x", payload, retry: undefined as never, handler }),
    ).toThrow(/retry policy/);
    expect(() =>
      defineJob({
        name: "system.x",
        payload,
        retry: { limit: -1, delaySeconds: 1, backoff: false },
        handler,
      }),
    ).toThrow(/retry policy/);
  });

  it("requires a <module>.<name> job name", () => {
    const payload = z.object({});
    const retry = { limit: 0, delaySeconds: 0, backoff: false };
    expect(() => defineJob({ name: "NoModule", payload, retry, handler })).toThrow(/name/);
  });

  it("rejects an invalid payload before it is enqueued", () => {
    const job = defineJob({
      name: "system.example",
      payload: z.object({ id: z.string() }),
      retry: { limit: 0, delaySeconds: 0, backoff: false },
      handler,
    });
    expect(parsePayload(job, { id: "a" })).toEqual({ id: "a" });
    expect(() => parsePayload(job, { id: 1 })).toThrow(/system.example/);
  });
});
