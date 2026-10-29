import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Principal } from "@/shared/rbac/principal";
import {
  assembleEventTypes,
  defineEventType,
  encodeEvent,
  MAX_EVENT_BYTES,
  shouldDeliver,
} from "../eventTypes";

const principal = (userId: string): Principal => ({
  userId,
  roleCode: "AGENT",
  bypassesAccess: false,
  permissions: new Set(),
});

const ping = defineEventType({
  name: "system.ping",
  payload: z.object({ targetUserId: z.string() }),
  canReceive: (who, payload) => who.userId === payload.targetUserId,
});

describe("defineEventType()", () => {
  it("accepts an object payload of ID strings", () => {
    expect(ping.name).toBe("system.ping");
  });

  it("rejects a payload that is not an object of strings (events carry IDs only)", () => {
    expect(() => defineEventType({ name: "system.bad", payload: z.string() as never })).toThrow(
      /IDs only/,
    );
    expect(() =>
      defineEventType({
        name: "system.bad",
        payload: z.object({ name: z.string(), count: z.number() }) as never,
      }),
    ).toThrow(/count/);
  });

  it("requires a <module>.<event> name", () => {
    expect(() => defineEventType({ name: "ping", payload: z.object({}) })).toThrow(/name/);
  });
});

describe("assembleEventTypes()", () => {
  it("collects every module's event types by name", () => {
    expect([...assembleEventTypes({ system: [ping] }).keys()]).toEqual(["system.ping"]);
  });

  it("rejects duplicate names and names outside their module", () => {
    expect(() => assembleEventTypes({ system: [ping, ping] })).toThrow(/duplicate/i);
    expect(() => assembleEventTypes({ leads: [ping] })).toThrow(/leads/);
  });
});

describe("encodeEvent()", () => {
  it("encodes the event name and payload", () => {
    expect(JSON.parse(encodeEvent(ping, { targetUserId: "u1" }))).toEqual({
      type: "system.ping",
      payload: { targetUserId: "u1" },
    });
  });

  it("validates the payload", () => {
    expect(() => encodeEvent(ping, { targetUserId: 7 } as never)).toThrow(/system.ping/);
  });

  it(`rejects an encoded event over ${MAX_EVENT_BYTES} bytes`, () => {
    expect(MAX_EVENT_BYTES).toBe(4096);
    expect(() => encodeEvent(ping, { targetUserId: "x".repeat(5000) })).toThrow(/4096/);
  });
});

describe("shouldDeliver()", () => {
  const unfiltered = defineEventType({
    name: "system.open",
    payload: z.object({ id: z.string() }),
  });
  const types = assembleEventTypes({ system: [ping, unfiltered] });
  const message = (type: string, payload: unknown) => ({ type, payload });

  it("delivers an event the principal may receive", async () => {
    await expect(
      shouldDeliver(types, principal("u1"), message("system.ping", { targetUserId: "u1" })),
    ).resolves.toBe(true);
  });

  it("drops an event the principal may not receive", async () => {
    await expect(
      shouldDeliver(types, principal("u2"), message("system.ping", { targetUserId: "u1" })),
    ).resolves.toBe(false);
  });

  it("never delivers an event type without a receive filter (default deny)", async () => {
    await expect(
      shouldDeliver(types, principal("u1"), message("system.open", { id: "a" })),
    ).resolves.toBe(false);
  });

  it("drops unknown event types and payloads that fail their schema", async () => {
    await expect(shouldDeliver(types, principal("u1"), message("system.nope", {}))).resolves.toBe(
      false,
    );
    await expect(
      shouldDeliver(types, principal("u1"), message("system.ping", { targetUserId: 1 })),
    ).resolves.toBe(false);
  });

  it("drops the event when the filter throws", async () => {
    const throwing = defineEventType({
      name: "system.boom",
      payload: z.object({ id: z.string() }),
      canReceive: () => {
        throw new Error("filter failed");
      },
    });
    const map = assembleEventTypes({ system: [throwing] });
    await expect(
      shouldDeliver(map, principal("u1"), message("system.boom", { id: "a" })),
    ).resolves.toBe(false);
  });
});
