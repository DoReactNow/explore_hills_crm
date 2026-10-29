import type { FriendlyError } from "@/shared/api/friendlyError";

/** Shows a mapped, friendly error. It only accepts a FriendlyError, never raw text. */
export function ErrorMessage({ error }: { error: FriendlyError }) {
  return (
    <div role="alert">
      <p>{error.message}</p>
      {error.requestId ? <p>Reference: {error.requestId}</p> : null}
    </div>
  );
}
