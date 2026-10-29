import { APP_CONFIG } from "@/shared/config/appConfig";

export default function HomePage() {
  return (
    <main>
      <h1>{APP_CONFIG.product.name}</h1>
      <p>
        Need help? Email{" "}
        <a href={`mailto:${APP_CONFIG.support.email}`}>{APP_CONFIG.support.email}</a> or call{" "}
        <a href={APP_CONFIG.support.phoneTelHref}>{APP_CONFIG.support.phoneDisplay}</a>.
      </p>
    </main>
  );
}
