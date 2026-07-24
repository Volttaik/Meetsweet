import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow serverless functions to run longer for media processing
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
