import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.tsx",
    auto: "src/auto.ts",
    instrumentation: "src/instrumentation.ts",
    middleware: "src/middleware.ts",
    "error-components": "src/error-components.tsx",
    config: "src/config.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    "@bugwatch/core",
    "@bugwatch/node",
    "next",
    "next/server",
    "react",
    "react-dom",
  ],
});
