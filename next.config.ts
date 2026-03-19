import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Content files are outside of src/, tell Next.js not to watch them
  // (chokidar in server.ts handles that)
  serverExternalPackages: ['chokidar'],
};

export default nextConfig;
