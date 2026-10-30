// P2-ROLES-13: a change of permission or an ended session applies to a stream already open.
import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@/shared/rbac/principal";
import { createEventStream } from "../sse";
import type { AnyEventType } from "../eventTypes";

vi.mock("../relay", () => {
  let listener: { onMessage: (message: unknown) => void } | undefined;
  return {
    subscribe: async (handlers: { onMessage: (message: unknown) => void }) => {
      listener = handlers;
      return () => undefined;
    },
    emit: (message: unknown) => listener?.onMessage(message),
  };
});

const principal = (permissions: string[]) =>
  ({
    userId: "u",
    roleCode: "X",
    bypassesAccess: false,
    permissions: new Set(permissions),
  }) as unknown as Principal;

const type = {
  name: "test.notice",
  payload: { safeParse: (data: unknown) => ({ success: true, data }) },
  canReceive: (who: Principal) => who.permissions.has("users:view" as never),
} as unknown as AnyEventType;

describe("an open stream", () => {
  it("stops delivering when the permission goes, and closes when the session ends", async () => {
    const relay = (await import("../relay")) as unknown as { emit: (message: unknown) => void };
    const resolve = vi
      .fn<() => Promise<Principal | null>>()
      .mockResolvedValueOnce(principal(["users:view"]))
      .mockResolvedValueOnce(principal([]))
      .mockResolvedValueOnce(null);
    const response = createEventStream({
      resolveCurrentPrincipal: resolve,
      types: new Map([["test.notice", type]]),
      signal: new AbortController().signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += decoder.decode(value);
      }
    })();

    await vi.waitFor(() => expect(text).toContain("connected"));
    relay.emit({ type: "test.notice", payload: { n: 1 } });
    await vi.waitFor(() => expect(text).toContain('"n":1'));
    relay.emit({ type: "test.notice", payload: { n: 2 } });
    relay.emit({ type: "test.notice", payload: { n: 3 } });
    await pump; // the stream ends when the session is gone
    expect(text).not.toContain('"n":2');
    expect(text).not.toContain('"n":3');
    expect(resolve).toHaveBeenCalledTimes(3);
  });
});
