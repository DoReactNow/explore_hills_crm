import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPage } from "@/modules/leads/ui/SettingsPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Settings · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <SettingsPage />
    </Suspense>
  );
}
