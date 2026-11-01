// Security headers (Decision 67). Pages get a policy with a fresh nonce from src/proxy.ts; everything
// else is fixed and comes from next.config.ts. Browsers ignore HSTS over plain http, so it is safe locally.

export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function pageContentSecurityPolicy(
  nonce: string,
  { development }: { development: boolean },
): string {
  return [
    "default-src 'self'",
    // React's debugging needs eval in development only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // React writes style attributes into the page, which a nonce can't cover.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

export const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()",
  },
];
