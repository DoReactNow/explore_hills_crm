import { APP_CONFIG } from "@/shared/config/appConfig";

/** How to reach support, from APP_CONFIG (the single source of truth). */
export function SupportContact() {
  const { email, phoneDisplay, phoneTelHref } = APP_CONFIG.support;
  return (
    <p>
      If this keeps happening, contact support at <a href={`mailto:${email}`}>{email}</a> or{" "}
      <a href={phoneTelHref}>{phoneDisplay}</a>.
    </p>
  );
}
