"use client";

// Single-key shortcuts for a page. They never fire while someone is typing, inside a dialog, or with
// a modifier held, so they can't take over a browser shortcut (P6-WORK-07).
import { useEffect, useRef } from "react";

const TYPING =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog']";

export function useShortcuts(keys: Record<string, (event: KeyboardEvent) => void>): void {
  const current = useRef(keys);
  useEffect(() => {
    current.current = keys;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest(TYPING)) return;
      const action = current.current[event.key];
      if (!action) return;
      event.preventDefault();
      action(event);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
