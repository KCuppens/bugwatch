import type { NextConfig } from "next";
import { withBugwatch } from "@bugwatch/nextjs";
import { createMDX } from "fumadocs-mdx/next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withMDX = createMDX();
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@bugwatch/nextjs", "@bugwatch/core", "@bugwatch/node"],
  output: "standalone",
  // Tree-shake icon libs so each page only pulls the icons it actually uses
  // instead of the whole barrel export.
  modularizeImports: {
    "lucide-react": {
      transform: "lucide-react/dist/esm/icons/{{kebabCase member}}",
      preventFullImport: true,
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}`,
              "font-src 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

const bugwatchApiKey = process.env.NEXT_PUBLIC_BUGWATCH_API_KEY;

const baseConfig = withBundleAnalyzer(withMDX(nextConfig));

export default bugwatchApiKey
  ? withBugwatch({
      apiKey: bugwatchApiKey,
      endpoint: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
      environment: process.env.NODE_ENV,
    })(baseConfig)
  : baseConfig;
