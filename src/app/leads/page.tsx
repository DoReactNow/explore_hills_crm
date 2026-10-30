import type { Metadata } from "next";
import { Suspense } from "react";
import { LeadsPage } from "@/modules/leads/ui/LeadsPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Leads · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <LeadsPage />
    </Suspense>
  );
}
