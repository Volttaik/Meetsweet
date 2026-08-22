import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Vercel's output tracing scoped to this standalone server package.
  outputFileTracingRoot: process.cwd(),
  // Allow serverless functions to run longer for media processing
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // ioredis (the realtime cross-instance bus) depends on Node built-ins
  // (net/tls) — keep it external to the server bundle per the Vercel chat
  // guide, or the Next.js build fails to resolve it.
  serverExternalPackages: ["ioredis"],
};

export default nextConfig;
