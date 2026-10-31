"use client";

// Warns before leaving a page with unsaved text: on closing the tab, and on following a link inside
// the app, which the browser's own warning doesn't cover (P6-WORK-04).
import { useEffect } from "react";

const MESSAGE = "You have unsaved text. Leave this page and lose it?";

export function useUnsavedWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.getAttribute("target") === "_blank" || link.hasAttribute("download"))
        return;
      if (!window.confirm(MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
