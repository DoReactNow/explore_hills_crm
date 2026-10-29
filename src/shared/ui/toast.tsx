"use client";

// A minimal toast for friendly errors. toastError() only accepts a FriendlyError.
import { useEffect, useState } from "react";
import type { FriendlyError } from "@/shared/api/friendlyError";

const TOAST_MS = 6000;

interface ToastItem {
  id: number;
  message: string;
  requestId?: string;
}

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const listener of listeners) listener(items);
}

export function toastError(error: FriendlyError): void {
  const item = { id: nextId++, message: error.message, requestId: error.requestId };
  items = [...items, item];
  emit();
  setTimeout(() => {
    items = items.filter((existing) => existing.id !== item.id);
    emit();
  }, TOAST_MS);
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
    <div role="status" aria-live="polite">
      {visible.map((item) => (
        <div key={item.id}>
          <p>{item.message}</p>
          {item.requestId ? <p>Reference: {item.requestId}</p> : null}
        </div>
      ))}
    </div>
  );
}
