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
};

export default nextConfig;
