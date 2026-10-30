import type { Metadata } from "next";
import { SignInForm } from "@/modules/identity/ui/SignInForm";
import { LogoMark } from "@/modules/identity/ui/LogoMark";
import { safeNextPath } from "@/modules/identity/ui/safeNextPath";
import styles from "@/modules/identity/ui/identity.module.css";
import { APP_CONFIG } from "@/shared/config/appConfig";

export const metadata: Metadata = { title: `Sign in · ${APP_CONFIG.product.name}` };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <svg
        className={styles.hills}
        viewBox="0 0 1440 220"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 220V150l140-70 110 60 160-110 150 100 120-50 170 90 140-80 180 90 120-60 150 70v20z"
          fill="#CFDDF0"
        />
        <path
          d="M0 220v-30l180-60 160 50 200-80 160 70 180-40 200 60 160-50 200 70v10z"
          fill="#BCD0EA"
        />
      </svg>
      <header className={styles.header}>
        <span className={styles.brandName}>
          <LogoMark />
          <span>
            {APP_CONFIG.company.legalName} <span className={styles.brandSuffix}>CRM</span>
          </span>
        </span>
        <span>Staff only</span>
      </header>
      <main className={styles.main}>
        <h1 className={styles.title}>
          Sign in to your <span className={styles.titleAccent}>workspace</span>
        </h1>
        <SignInForm next={safeNextPath(typeof next === "string" ? next : null)} />
      </main>
      <footer className={styles.footer}>
        For {APP_CONFIG.company.legalName} staff only. Sign-ins and changes are recorded.
      </footer>
    </div>
  );
}
