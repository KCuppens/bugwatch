import type { NextConfig } from "next";
import { withBugwatch } from "@bugwatch/nextjs";
import { createMDX } from "fumadocs-mdx/next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withMDX = createMDX();
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @bugwatch/core is isomorphic and safe to transpile/bundle. @bugwatch/node
  // and @bugwatch/nextjs import Node built-ins (`os`, via instrumentation) and
  // run only on the server — keep them external so Next doesn't bundle them
  // (and choke resolving `os` for the edge runtime).
  transpilePackages: ["@bugwatch/core"],
  serverExternalPackages: ["@bugwatch/node", "@bugwatch/nextjs"],
  webpack(config, { dev }) {
    if (dev) {
      // Docker on Windows doesn't relay inotify events — force polling so
      // webpack detects file changes without native FS events.
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
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

    // Dev needs `'unsafe-eval'` (Next's react-refresh runtime) and `data:` fonts
    // (Tailwind/lucide-react inline woff2). Without these the dev bundle fails
    // to evaluate and React never hydrates — typing into inputs silently does
    // nothing because the page is effectively static HTML.
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";

    // Both HTTP API and the matching WebSocket origin must be allowed. In dev,
    // also allow the dev-server WS (localhost + the public dev domain via wss).
    const wsOrigin = apiUrl.replace(/^http/, "ws");
    const connectSrc = isDev
      ? `connect-src 'self' ${apiUrl} ${wsOrigin} ws://localhost:3001 ws://localhost:3000 wss://dev.bugwatch.dev wss://api-dev.bugwatch.dev`
      : `connect-src 'self' ${apiUrl} ${wsOrigin}`;

    const fontSrc = isDev
      ? "font-src 'self' data: https://api.fontshare.com https://cdn.fontshare.com"
      : "font-src 'self' https://api.fontshare.com https://cdn.fontshare.com";

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
              scriptSrc,
              "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
              "img-src 'self' data: blob:",
              connectSrc,
              fontSrc,
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
