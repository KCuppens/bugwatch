import type { NextConfig } from "next";
import { withBugwatch } from "@bugwatch/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@bugwatch/shared", "@bugwatch/nextjs", "@bugwatch/core", "@bugwatch/node"],
  output: "standalone",
};

export default withBugwatch({
  apiKey: "bw_live_3047f2aaca22496d8f1010960cff1595",
  environment: process.env.NODE_ENV,
})(nextConfig);
