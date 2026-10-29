import type { ReactNode } from "react";

// Page metadata is wired to APP_CONFIG in W-002 (single source of truth).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
