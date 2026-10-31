// P6-WORK-06: older messages keep the reader's place, and new ones don't jump the page.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatThread, type Detail, type Message } from "../ui/chatParts";

vi.mock("@/shared/rbac/usePrincipal", () => ({ usePrincipal: () => ({ can: () => false }) }));

const message = (id: string, direction: Message["direction"] = "INBOUND"): Message => ({
  id,
  direction,
  type: "TEXT",
  body: `text ${id}`,
  mediaStatus: null,
  mediaFilename: null,
  status: "DELIVERED",
  failureMessage: null,
  occurredAt: "2026-11-02T06:00:00.000Z",
});
const chat = (messages: Message[], hasOlder = false): Detail => ({
  id: "c1",
  waId: "919800000000",
  unreadCount: 0,
  lastMessageAt: null,
  window: { open: true, closesAt: null },
  contact: { name: "Asha", phoneE164: "+919800000000", optInStatus: "OPTED_IN" },
  lead: null,
  hasOlder,
  messages,
});
const props = { onChanged: vi.fn(), onError: vi.fn() };
let height = 1000;

beforeEach(() => {
  height = 1000;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const box = () => screen.getByText("text m1").closest("[aria-live]") as HTMLElement;
const scrollUp = () => {
  box().scrollTop = 100;
  fireEvent.scroll(box());
};

describe("ChatThread", () => {
  it("opens at the newest message", () => {
    render(<ChatThread conversation={chat([message("m1")])} {...props} />);
    expect(box().scrollTop).toBe(1000);
  });

  it("stays put when a message arrives while reading back, and offers a way down", () => {
    const { rerender } = render(<ChatThread conversation={chat([message("m1")])} {...props} />);
    scrollUp();
    height = 1100;
    rerender(<ChatThread conversation={chat([message("m1"), message("m2")])} {...props} />);
    expect(box().scrollTop).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: /New message/ }));
    expect(box().scrollTop).toBe(1100);
  });

  it("follows a new message at the end, and always the person's own", () => {
    const { rerender } = render(<ChatThread conversation={chat([message("m1")])} {...props} />);
    height = 1100;
    rerender(<ChatThread conversation={chat([message("m1"), message("m2")])} {...props} />);
    expect(box().scrollTop).toBe(1100);
    scrollUp();
    height = 1200;
    rerender(
      <ChatThread
        conversation={chat([message("m1"), message("m2"), message("m3", "OUTBOUND")])}
        {...props}
      />,
    );
    expect(box().scrollTop).toBe(1200);
  });

  it("keeps the reader's place when older messages load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        height = 1500;
        return new Response(
          JSON.stringify({ data: { messages: [message("m0")], hasOlder: false } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    render(<ChatThread conversation={chat([message("m1")], true)} {...props} />);
    scrollUp();
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    await screen.findByText("text m0");
    await waitFor(() => expect(box().scrollTop).toBe(100));
    expect(screen.queryByRole("button", { name: "Load older messages" })).toBeNull();
  });
});
