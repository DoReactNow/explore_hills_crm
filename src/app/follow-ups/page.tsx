import type { Metadata } from "next";
import { Suspense } from "react";
import { FollowUpsPage } from "@/modules/leads/ui/FollowUpsPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Follow-ups · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <FollowUpsPage />
    </Suspense>
  );
}
