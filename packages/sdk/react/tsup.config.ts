import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ["@bugwatch/core", "react", "react-dom"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
