import { defineConfig } from "vitest/config";
import path from "path";

// react-native is a peer dependency that is not installed in the monorepo, so
// every test resolves it to a controllable mock.
export default defineConfig({
  resolve: {
    alias: {
      "react-native": path.resolve(__dirname, "src/test/react-native.mock.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
