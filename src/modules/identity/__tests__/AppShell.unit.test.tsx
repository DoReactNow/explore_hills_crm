import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../ui/AppShell";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const me = (permissions: string[]) =>
  respond(200, {
    data: {
      id: "1",
      name: "Tara Singh",
      email: "t@example.com",
      role: { code: "ADMIN", name: "Admin" },
      permissions,
    },
  });
const signedOut = () =>
  respond(401, { error: { code: "UNAUTHENTICATED", message: "x", requestId: "r" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  pathname = "/";
});

describe("AppShell", () => {
  it("shows the signed-in user's name, role and a sign-out button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me([])),
    );
    render(
      <AppShell onSignedOut={vi.fn()}>
        <p>page</p>
      </AppShell>,
    );
    expect(await screen.findByText("Tara Singh")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.getByText("page")).toBeTruthy();
  });

  it("removes navigation the person cannot use, and never prints a code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me([])),
    );
    const { container, unmount } = render(
      <AppShell onSignedOut={vi.fn()}>
        <p>page</p>
      </AppShell>,
    );
    await screen.findByText("Tara Singh");
    expect(screen.queryByRole("link", { name: "Diagnostics" })).toBeNull();
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => me(["system:view-diagnostics"])),
    );
    const second = render(
      <AppShell onSignedOut={vi.fn()}>
        <p>page</p>
      </AppShell>,
    );
    expect(await screen.findByRole("link", { name: "Diagnostics" })).toBeTruthy();
    expect(second.container.textContent).not.toContain("system:view-diagnostics");
    expect(container.textContent).toBe("");
  });

  it("signed out, shows a sign-in link that returns to this page", async () => {
    pathname = "/diagnostics";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => signedOut()),
    );
    render(
      <AppShell onSignedOut={vi.fn()}>
        <p>page</p>
      </AppShell>,
    );
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/sign-in?next=%2Fdiagnostics");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("signing out calls the server, then leaves", async () => {
    const fetchMock = vi.fn(async (path: string) =>
      path === "/api/auth/me" ? me([]) : respond(200, { data: { signedOut: true } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSignedOut = vi.fn();
    render(
      <AppShell onSignedOut={onSignedOut}>
        <p>page</p>
      </AppShell>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(fetchMock.mock.calls.map(([path]) => path)).toContain("/api/auth/sign-out");
  });

  it("the sign-in page has no shell and asks nothing of the server", () => {
    pathname = "/sign-in";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AppShell onSignedOut={vi.fn()}>
        <p>page</p>
      </AppShell>,
    );
    expect(screen.getByText("page")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
