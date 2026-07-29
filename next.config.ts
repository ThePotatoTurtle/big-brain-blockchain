import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // resvg-js ships a native .node binary that bundlers can't inline. Keeping it
  // external makes it load from node_modules at runtime instead.
  serverExternalPackages: ["@resvg/resvg-js"],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
