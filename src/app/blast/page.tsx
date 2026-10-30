import type { Metadata } from "next";
import { Suspense } from "react";
import { BlastPage } from "@/modules/assignment/ui/BlastPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Blast pool · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <BlastPage />
    </Suspense>
  );
}
