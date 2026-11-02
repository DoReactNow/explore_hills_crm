// Gives every page a fresh nonce and a content security policy (Decision 67). Next.js reads the nonce
// from the request's policy and puts it on its own scripts. API routes stay out, so uploads and live
// streams are not buffered here; their fixed headers come from next.config.ts.
import { NextResponse, type NextRequest } from "next/server";
import { createNonce, pageContentSecurityPolicy } from "@/shared/http/securityHeaders";

export function proxy(request: NextRequest) {
  const policy = pageContentSecurityPolicy(createNonce(), {
    // Set by Next.js itself and not part of the app's environment schema.
    // eslint-disable-next-line no-restricted-properties
    development: process.env.NODE_ENV === "development",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
