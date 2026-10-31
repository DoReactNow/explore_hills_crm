import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveEvents } from "../useLiveEvents";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function Probe(props: { onEvent: (type: string, payload: unknown) => void; onResync: () => void }) {
  useLiveEvents({ types: ["system.ping"], pollIntervalMs: 15_000, ...props });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useLiveEvents()", () => {
  it("opens the stream and passes events of the requested types to onEvent", () => {
    const onEvent = vi.fn();
    render(<Probe onEvent={onEvent} onResync={vi.fn()} />);
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe("/api/events/stream");
    act(() => source.emit("system.ping", { targetUserId: "u1" }));
    expect(onEvent).toHaveBeenCalledWith("system.ping", { targetUserId: "u1" });
  });

  it("falls back to polling at the configured interval when the stream errors", () => {
    const onResync = vi.fn();
    render(<Probe onEvent={vi.fn()} onResync={onResync} />);
    const source = FakeEventSource.instances[0];
    act(() => source.onopen?.());
    onResync.mockClear();

    act(() => source.onerror?.());
    act(() => vi.advanceTimersByTime(15_000));
    expect(onResync).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30_000));
    expect(onResync).toHaveBeenCalledTimes(3);
  });

  it("re-fetches once and stops polling when the stream reconnects", () => {
    const onResync = vi.fn();
    render(<Probe onEvent={vi.fn()} onResync={onResync} />);
    const source = FakeEventSource.instances[0];
    act(() => source.onopen?.());
    act(() => source.onerror?.());
    act(() => vi.advanceTimersByTime(15_000));
    onResync.mockClear();

    act(() => source.onopen?.()); // EventSource reconnected by itself
    expect(onResync).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("shares one connection in a tab, giving each listener only its own types", () => {
    const [ping, other] = [vi.fn(), vi.fn()];
    function Two() {
      useLiveEvents({ types: ["system.ping"], onEvent: ping, onResync: vi.fn() });
      useLiveEvents({ types: ["system.other"], onEvent: other, onResync: vi.fn() });
      return null;
    }
    const { unmount } = render(<Two />);
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];
    act(() => source.emit("system.ping", {}));
    expect(ping).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    unmount();
    expect(source.closed).toBe(true);
  });

  it("keeps the connection until the last listener leaves", () => {
    const { unmount } = render(<Probe onEvent={vi.fn()} onResync={vi.fn()} />);
    const second = render(<Probe onEvent={vi.fn()} onResync={vi.fn()} />);
    const source = FakeEventSource.instances[0];
    unmount();
    expect(source.closed).toBe(false);
    second.unmount();
    expect(source.closed).toBe(true);
  });

  it("closes the stream when the component unmounts", () => {
    const { unmount } = render(<Probe onEvent={vi.fn()} onResync={vi.fn()} />);
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
