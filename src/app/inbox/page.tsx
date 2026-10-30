import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxPage } from "@/modules/messaging/ui/InboxPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Inbox · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <InboxPage />
    </Suspense>
  );
}
