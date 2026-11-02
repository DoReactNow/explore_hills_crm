"use client";

// Toasts (owner's design: dark, bottom-left on desktop, above the tab bar on phones, 6 s, paused
// while hovered). toastError() only accepts a FriendlyError; toastSuccess() takes our own words.
import { useEffect, useState } from "react";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { Icon } from "./Icon";
import styles from "./toast.module.css";

const TOAST_MS = 6000;

interface ToastItem {
  id: number;
  tone: "error" | "success";
  message: string;
  requestId?: string;
}

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener(items);
}

function dismiss(id: number) {
  timers.delete(id);
  items = items.filter((existing) => existing.id !== id);
  emit();
}

function schedule(id: number) {
  timers.set(
    id,
    setTimeout(() => dismiss(id), TOAST_MS),
  );
}

function show(item: Omit<ToastItem, "id">) {
  const id = nextId++;
  items = [...items, { ...item, id }];
  emit();
  schedule(id);
}

export function toastError(error: FriendlyError): void {
  show({ tone: "error", message: error.message, requestId: error.requestId });
}

export function toastSuccess(message: string): void {
  show({ tone: "success", message });
}

export function Toaster() {
  const [visible, setVisible] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setVisible);
    return () => {
      listeners.delete(setVisible);
    };
  }, []);

  return (
    <div role="status" aria-live="polite" className={styles.stack}>
      {visible.map((item) => (
        <div
          key={item.id}
          className={styles.toast}
          onMouseEnter={() => {
            clearTimeout(timers.get(item.id));
          }}
          onMouseLeave={() => schedule(item.id)}
        >
          <span className={item.tone === "error" ? styles.iconError : styles.iconSuccess}>
            <Icon name={item.tone === "error" ? "warning" : "check"} size={18} strokeWidth={2} />
          </span>
          <span className={styles.text}>
            <p>{item.message}</p>
            {item.requestId ? (
              <p className={styles.reference}>Reference: {item.requestId}</p>
            ) : null}
          </span>
          <button
            type="button"
            className={styles.close}
            aria-label="Dismiss"
            onClick={() => {
              clearTimeout(timers.get(item.id));
              dismiss(item.id);
            }}
          >
            <Icon name="close" size={14} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
