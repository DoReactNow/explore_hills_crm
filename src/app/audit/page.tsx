import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditPage } from "@/modules/audit/ui/AuditPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Audit trail · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <AuditPage />
    </Suspense>
  );
}
