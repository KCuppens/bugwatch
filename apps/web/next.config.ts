import type { NextConfig } from "next";
import { withBugwatch } from "@bugwatch/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@bugwatch/nextjs", "@bugwatch/core", "@bugwatch/node"],
  output: "standalone",
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

const bugwatchApiKey = process.env.NEXT_PUBLIC_BUGWATCH_API_KEY;

export default bugwatchApiKey
  ? withBugwatch({
      apiKey: bugwatchApiKey,
      endpoint: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
      environment: process.env.NODE_ENV,
    })(nextConfig)
  : nextConfig;
