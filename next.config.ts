import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for Azure App Service (run with `node server.js`)
  output: "standalone",
};

export default nextConfig;
