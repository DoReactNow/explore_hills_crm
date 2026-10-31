import type { Metadata } from "next";
import { Instrument_Serif, Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";
import type { ReactNode } from "react";
import { SoftphoneProvider } from "@/modules/telephony/ui/SoftphoneProvider";
import { AppShell } from "@/modules/identity/ui/AppShell";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { Toaster } from "@/shared/ui/toast";
import "./globals.css";

// Served from this app at runtime, so no browser ever calls Google for a font.
const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});
const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-devanagari",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-accent",
});

export const metadata: Metadata = {
  title: APP_CONFIG.product.name,
  description: `${APP_CONFIG.product.name} for ${APP_CONFIG.company.legalName}`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={APP_CONFIG.locale.locale}
      className={`${notoSans.variable} ${notoDevanagari.variable} ${instrumentSerif.variable}`}
    >
      <body>
        <AppShell>
          <SoftphoneProvider>{children}</SoftphoneProvider>
        </AppShell>
        <Toaster />
      </body>
    </html>
  );
}
