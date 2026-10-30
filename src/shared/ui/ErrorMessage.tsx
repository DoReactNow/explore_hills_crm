"use client";

import { usePathname } from "next/navigation";
import type { FriendlyError } from "@/shared/api/friendlyError";

/** Shows a mapped, friendly error. It only accepts a FriendlyError, never raw text. */
export function ErrorMessage({ error }: { error: FriendlyError }) {
  const pathname = usePathname();
  return (
    <div role="alert">
      <p>{error.message}</p>
      {error.code === "UNAUTHENTICATED" ? (
        <p>
          <a href={`/sign-in?next=${encodeURIComponent(pathname ?? "/")}`}>Go to sign in</a>
        </p>
      ) : null}
      {error.requestId ? <p>Reference: {error.requestId}</p> : null}
    </div>
  );
}
