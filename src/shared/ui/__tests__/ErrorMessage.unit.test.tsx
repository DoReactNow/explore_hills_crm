import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toFriendlyError } from "@/shared/api/friendlyError";
import { ErrorMessage } from "../ErrorMessage";
import { Toaster, toastError } from "../toast";

afterEach(cleanup);

describe("<ErrorMessage />", () => {
  it("shows the friendly message and the reference", () => {
    const error = toFriendlyError({
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "boom",
          requestId: "11111111-2222-4333-8444-555555555555",
        },
      },
    });
    render(<ErrorMessage error={error} />);
    expect(screen.getByRole("alert").textContent).toContain(error.message);
    expect(screen.getByText(/Reference: 11111111-2222-4333-8444-555555555555/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("boom");
  });

  it("omits the reference line when there is none", () => {
    render(<ErrorMessage error={toFriendlyError({ networkError: true })} />);
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });
});

describe("toastError / <Toaster />", () => {
  it("shows a toast with the friendly message", () => {
    render(<Toaster />);
    const error = toFriendlyError({ status: 429 });
    act(() => toastError(error));
    expect(screen.getByRole("status").textContent).toContain(error.message);
  });
});
