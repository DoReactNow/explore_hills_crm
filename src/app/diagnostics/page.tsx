import type { Metadata } from "next";
import { DiagnosticsPage } from "@/modules/monitoring/ui/DiagnosticsPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Diagnostics · ${APP_CONFIG.product.name}` };

export default function Page() {
  return <DiagnosticsPage />;
}
