import { toFriendlyError } from "@/shared/api/friendlyError";
import { ErrorMessage } from "./ErrorMessage";
import { SupportContact } from "./SupportContact";

/** Body of the error pages: catalog message, reference (Next's error digest) and support. */
export function ErrorPageContent({ error, retry }: { error: unknown; retry: () => void }) {
  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : undefined;
  const friendly = toFriendlyError({ status: 500, reference: digest });
  return (
    <main>
      <h1>Something went wrong</h1>
      <ErrorMessage error={friendly} />
      <button type="button" onClick={() => retry()}>
        Try again
      </button>
      <SupportContact />
    </main>
  );
}
