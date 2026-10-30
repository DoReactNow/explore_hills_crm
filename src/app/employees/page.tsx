import type { Metadata } from "next";
import { Suspense } from "react";
import { EmployeesPage } from "@/modules/identity/ui/EmployeesPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Employees · ${APP_CONFIG.product.name}` };

export default function Page() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <EmployeesPage />
    </Suspense>
  );
}
