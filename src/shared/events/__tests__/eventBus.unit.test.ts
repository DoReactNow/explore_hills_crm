import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../eventBus";

type TestEvents = {
  "lead.created": { leadId: string };
  "lead.assigned": { leadId: string; toUserId: string };
};

describe("event bus", () => {
  it("delivers a published event to every subscriber of that name only", async () => {
    const bus = createEventBus<TestEvents>();
    const created = vi.fn();
    const assigned = vi.fn();
    bus.subscribe("lead.created", created);
    bus.subscribe("lead.assigned", assigned);

    await bus.publish("lead.created", { leadId: "L1" });

    expect(created).toHaveBeenCalledWith({ leadId: "L1" });
    expect(assigned).not.toHaveBeenCalled();
  });

  it("gives each subscriber its own copy of the payload", async () => {
    const bus = createEventBus<TestEvents>();
    const payload = { leadId: "L1" };
    let received: { leadId: string } | undefined;
    bus.subscribe("lead.created", (event) => {
      received = event;
    });
    await bus.publish("lead.created", payload);
    expect(received).toEqual(payload);
    expect(received).not.toBe(payload);
  });

  it("stops delivering after unsubscribe", async () => {
    const bus = createEventBus<TestEvents>();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("lead.created", handler);
    unsubscribe();
    await bus.publish("lead.created", { leadId: "L1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects payloads that are not plain serialisable data", async () => {
    const bus = createEventBus<Record<string, unknown>>();
    await expect(bus.publish("x", { at: new Date(0) })).rejects.toThrow(/serialisable/);
    await expect(bus.publish("x", { fn: () => 1 })).rejects.toThrow(/serialisable/);
    await expect(bus.publish("x", { n: Number.NaN })).rejects.toThrow(/serialisable/);
    await expect(bus.publish("x", { ok: [1, "a", true, null, { b: 2 }] })).resolves.toBeUndefined();
  });

  it("keeps delivering to other subscribers when one fails, and reports the failure", async () => {
    const onHandlerError = vi.fn();
    const bus = createEventBus<TestEvents>({ onHandlerError });
    const after = vi.fn();
    bus.subscribe("lead.created", () => {
      throw new Error("boom");
    });
    bus.subscribe("lead.created", after);

    await bus.publish("lead.created", { leadId: "L1" });

    expect(after).toHaveBeenCalled();
    expect(onHandlerError).toHaveBeenCalledWith("lead.created", expect.any(Error));
  });
});
