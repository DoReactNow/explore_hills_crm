"use client";

// Replaces the root layout when the layout itself fails, so it renders its own document.
import { APP_CONFIG } from "@/shared/config/appConfig";
import { ErrorPageContent } from "@/shared/ui/ErrorPageContent";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang={APP_CONFIG.locale.locale}>
      <body>
        <title>{APP_CONFIG.product.name}</title>
        <ErrorPageContent error={error} retry={retry} />
      </body>
    </html>
  );
}
