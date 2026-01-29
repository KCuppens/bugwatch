import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@bugwatch/shared", "@bugwatch/nextjs", "@bugwatch/core", "@bugwatch/node"],
};

export default nextConfig;
