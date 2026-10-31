import type { Metadata } from "next";
import { NotificationsPage } from "@/modules/notifications/ui/NotificationsPage";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Notifications · ${APP_CONFIG.product.name}` };

export default function Page() {
  return <NotificationsPage />;
}
