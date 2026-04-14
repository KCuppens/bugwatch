import type { NextConfig } from "next";
import { withBugwatch } from "@bugwatch/nextjs";
import { createMDX } from "fumadocs-mdx/next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withMDX = createMDX();
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@bugwatch/nextjs", "@bugwatch/core", "@bugwatch/node"],
  webpack(config, { dev }) {
    if (dev) {
      // Use cheap-module-source-map instead of the default eval-based devtool
      // so that CSP script-src does not need 'unsafe-eval' in development.
      config.devtool = "cheap-module-source-map";
    }
    return config;
  },
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
    const isDev = process.env.NODE_ENV === "development";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    // In dev, HMR needs a WebSocket connection back to the dev server.
    const connectSrc = isDev
      ? `connect-src 'self' ${apiUrl} ws://localhost:3001 ws://localhost:3000`
      : `connect-src 'self' ${apiUrl}`;
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
              connectSrc,
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
