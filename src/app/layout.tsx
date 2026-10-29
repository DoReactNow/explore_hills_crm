import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = {
  title: APP_CONFIG.product.name,
  description: `${APP_CONFIG.product.name} for ${APP_CONFIG.company.legalName}`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={APP_CONFIG.locale.locale}>
      <body>{children}</body>
    </html>
  );
}
