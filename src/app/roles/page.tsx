import type { Metadata } from "next";
import { Suspense } from "react";
import { RolesPage } from "@/modules/identity/ui/RolesPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Roles & Permissions · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <RolesPage />
    </Suspense>
  );
}
