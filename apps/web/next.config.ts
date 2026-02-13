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

export default withBugwatch({
  apiKey: process.env.NEXT_PUBLIC_BUGWATCH_API_KEY || "",
  environment: process.env.NODE_ENV,
})(nextConfig);
