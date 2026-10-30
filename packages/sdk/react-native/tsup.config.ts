import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ["@bugwatch/core", "react", "react-native"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
