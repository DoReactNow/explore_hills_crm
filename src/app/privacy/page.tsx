import type { Metadata } from "next";
import { Suspense } from "react";
import { PrivacyPage } from "@/modules/privacy/ui/PrivacyPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Customer privacy · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <PrivacyPage />
    </Suspense>
  );
}
