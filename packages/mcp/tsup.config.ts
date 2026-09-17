import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/http.ts"],
  format: ["cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  minify: false,
  banner: { js: "#!/usr/bin/env node" },
});
