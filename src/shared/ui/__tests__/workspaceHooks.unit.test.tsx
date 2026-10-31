// P6-WORK-04 and P6-WORK-07: leaving with unsaved text warns; shortcuts never fire while typing.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShortcuts } from "../useShortcuts";
import { useUnsavedWarning } from "../useUnsavedWarning";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Keys({ onN }: { onN: () => void }) {
  useShortcuts({ n: onN });
  return (
    <>
      <input aria-label="text" />
      <textarea aria-label="area" />
      <select aria-label="pick" />
      <div aria-label="rich" contentEditable suppressContentEditableWarning />
      <div role="dialog">
        <button type="button">inside</button>
      </div>
    </>
  );
}

describe("useShortcuts", () => {
  it("fires on the page", () => {
    const onN = vi.fn();
    render(<Keys onN={onN} />);
    fireEvent.keyDown(document.body, { key: "n" });
    expect(onN).toHaveBeenCalledOnce();
  });

  it.each(["text", "area", "pick", "rich"])("stays quiet while typing in %s", (label) => {
    const onN = vi.fn();
    render(<Keys onN={onN} />);
    fireEvent.keyDown(screen.getByLabelText(label), { key: "n" });
    expect(onN).not.toHaveBeenCalled();
  });

  it("stays quiet inside a dialog and with a modifier held", () => {
    const onN = vi.fn();
    render(<Keys onN={onN} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "inside" }), { key: "n" });
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    expect(onN).not.toHaveBeenCalled();
  });
});

function Form({ dirty }: { dirty: boolean }) {
  useUnsavedWarning(dirty);
  return <a href="/elsewhere">Away</a>;
}

describe("useUnsavedWarning", () => {
  const click = () => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name: "Away" }).dispatchEvent(event);
    return event;
  };

  it("asks before following a link, and stays if refused", () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<Form dirty />);
    expect(click().defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("leaves if the person agrees", () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    render(<Form dirty />);
    const event = click();
    expect(event.defaultPrevented).toBe(false);
    event.preventDefault(); // jsdom can't navigate
  });

  it("says nothing with nothing unsaved", () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    render(<Form dirty={false} />);
    click().preventDefault();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("warns on closing the tab only when something is unsaved", () => {
    const { rerender } = render(<Form dirty />);
    const closing = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(closing()).toBe(true);
    rerender(<Form dirty={false} />);
    expect(closing()).toBe(false);
  });
});
