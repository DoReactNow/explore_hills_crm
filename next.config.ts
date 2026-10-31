import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  // Production image runs .next/standalone/server.js (docker/Dockerfile.prod, W-010).
  output: "standalone",
};

export default nextConfig;
