import type { Metadata } from "next";
import { Suspense } from "react";
import { QueuePage } from "@/modules/assignment/ui/QueuePage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Queue · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <QueuePage />
    </Suspense>
  );
}
