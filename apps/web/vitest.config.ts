import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["lcov", "json-summary", "text"],
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
      },
      exclude: [
        "src/components/ui/**",
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "node_modules/**",
        ".next/**",
        "dist/**",
      ],
    },
  },
});
