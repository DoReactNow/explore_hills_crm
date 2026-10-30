import type { Metadata } from "next";
import { Suspense } from "react";
import { AssignmentRulesPage } from "@/modules/assignment/ui/AssignmentRulesPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Assignment rules · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <AssignmentRulesPage />
    </Suspense>
  );
}
