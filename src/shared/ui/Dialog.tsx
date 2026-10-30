"use client";

// A modal dialog: takes focus when it opens, closes on Escape, and gives focus back when it closes.
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea, button");
    (first ?? panel.current)?.focus();
    return () => opener?.focus?.();
  }, []);

  return (
    <div className={styles.backdrop}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={styles.panel}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
