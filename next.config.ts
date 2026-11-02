import type { NextConfig } from "next";
import {
  API_CONTENT_SECURITY_POLICY,
  STATIC_SECURITY_HEADERS,
} from "./src/shared/http/securityHeaders";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  // Production image runs .next/standalone/server.js (docker/Dockerfile.prod, W-010).
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: STATIC_SECURITY_HEADERS },
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }],
      },
    ];
  },
};

export default nextConfig;
