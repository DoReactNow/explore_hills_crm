// A slow agent list must never change who the manager picked (P5-MODE-01).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssignPanel } from "../ui/QueuePage";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const AGENTS = ["a1", "a2"].map((id) => ({
  id,
  name: id,
  openLeads: 0,
  cap: 5,
  room: 5,
  block: null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the assign panel", () => {
  it("in one-agent mode, starts with nobody chosen and asks only for the agent picked", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/preview")) {
          bodies.push(JSON.parse(String(init?.body)));
          return json({ leadCount: 1, leadIds: ["l1"], rows: [], unplaced: [], agents: [] });
        }
        return json({ items: AGENTS });
      }),
    );
    render(
      <AssignPanel selected={["l1"]} all={false} count={1} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("radio", { name: /One agent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next: choose agents" }));
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(await screen.findByRole("radio", { name: /a2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ userIds: ["a2"], mode: "MANUAL" });
  });

  it("keeps the choice when the list arrives after it", async () => {
    let release: (value: Response) => void = () => undefined;
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes("/preview")) {
          bodies.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            json({ leadCount: 1, leadIds: ["l1"], rows: [], unplaced: [], agents: [] }),
          );
        }
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    render(
      <AssignPanel selected={["l1"]} all={false} count={1} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /One agent/ }));
    release(json({ items: AGENTS }));
    fireEvent.click(screen.getByRole("button", { name: "Next: choose agents" }));
    fireEvent.click(await screen.findByRole("radio", { name: /a1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ userIds: ["a1"] });
  });
});
