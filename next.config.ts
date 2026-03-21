import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Content files are outside of src/, tell Next.js not to watch them
  // (chokidar in server.ts handles that)
  serverExternalPackages: ['chokidar'],
  // Allow Tailscale and local network access to dev HMR/resources
  allowedDevOrigins: ['100.91.112.69'],
  devIndicators: false,
};

export default nextConfig;
