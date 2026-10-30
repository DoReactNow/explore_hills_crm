import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../Dialog";

afterEach(cleanup);

describe("Dialog", () => {
  it("is named, takes focus and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Rename" onClose={onClose}>
        <input aria-label="Name" />
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Rename" });
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
