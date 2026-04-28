import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack for better Tailwind CSS v4 compatibility
  turbopack: {
    rules: {},
  },
};

export default nextConfig;
