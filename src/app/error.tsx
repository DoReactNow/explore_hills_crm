"use client";

// Friendly error page for failures inside the root layout (Decision 8). The real error stays
// in the server log; the page shows only the catalog message and a reference.
import { ErrorPageContent } from "@/shared/ui/ErrorPageContent";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPageContent error={error} retry={retry} />;
}
