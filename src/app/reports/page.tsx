import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsPage } from "@/modules/reporting/ui/ReportsPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Reports · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <ReportsPage />
    </Suspense>
  );
}
