import type { Metadata } from "next";
import { Suspense } from "react";
import { CallsPage } from "@/modules/telephony/ui/CallsPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Calls · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <CallsPage />
    </Suspense>
  );
}
