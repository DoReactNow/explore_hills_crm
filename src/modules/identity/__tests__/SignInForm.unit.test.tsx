import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "../ui/SignInForm";

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fill(email = "a@example.com", password = "secret") {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SignInForm", () => {
  it("shows the field messages from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(400, {
          error: {
            code: "VALIDATION_FAILED",
            message: "x",
            requestId: "r",
            fieldErrors: [{ field: "email", message: "Please enter your email." }],
          },
        }),
      ),
    );
    render(<SignInForm next="/" onSignedIn={vi.fn()} />);
    submit();
    expect(await screen.findByText("Please enter your email.")).toBeTruthy();
  });

  it("shows the catalog sentence, never the server's raw text, and keeps the email", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(401, {
          error: { code: "INVALID_CREDENTIALS", message: "prisma exploded", requestId: "r" },
        }),
      ),
    );
    render(<SignInForm next="/" onSignedIn={vi.fn()} />);
    fill();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That email and password don't match.");
    expect(alert.textContent).not.toContain("prisma");
    expect((screen.getByLabelText("Work email") as HTMLInputElement).value).toBe("a@example.com");
    expect(screen.getByText(/Caps Lock/)).toBeTruthy();
  });

  it("shows one fixed message when locked, and stays usable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(429, { error: { code: "RATE_LIMITED", message: "x", requestId: "r" } }),
      ),
    );
    render(<SignInForm next="/" onSignedIn={vi.fn()} />);
    fill();
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Too many attempts");
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("has no keep-signed-in checkbox (Decision 53)", () => {
    render(<SignInForm next="/" onSignedIn={vi.fn()} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("disables the button while submitting, so a double click sends once (X-RACE-01)", async () => {
    let finish: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (finish = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    render(<SignInForm next="/" onSignedIn={vi.fn()} />);
    fill();
    submit();
    const busy = await screen.findByRole("button", { name: /Signing in/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(respond(200, { data: { id: "1" } }));
  });

  it("goes to the next page after signing in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(200, { data: { id: "1" } })),
    );
    const onSignedIn = vi.fn();
    render(<SignInForm next="/diagnostics" onSignedIn={onSignedIn} />);
    fill();
    submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("/diagnostics"));
  });

  it("shows the network sentence when the server cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("failed");
      }),
    );
    render(<SignInForm next="/" onSignedIn={vi.fn()} />);
    fill();
    submit();
    expect((await screen.findByRole("alert")).textContent).not.toContain("failed");
  });

  it("can show and hide the password", () => {
    render(<SignInForm next="/" onSignedIn={vi.fn()} />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });
});
