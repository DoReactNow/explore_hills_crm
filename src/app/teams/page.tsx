import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamsPage } from "@/modules/identity/ui/TeamsPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Teams · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <TeamsPage />
    </Suspense>
  );
}
