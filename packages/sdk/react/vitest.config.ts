import { defineConfig } from "vitest/config";
import path from "path";

// Force all React imports to the same root copy to prevent the "multiple
// copies of React" error that occurs when the local node_modules/react (18)
// and the root node_modules/react-dom (19) are different major versions.
const rootReact = path.resolve(__dirname, "../../../node_modules/react");
const rootReactDom = path.resolve(__dirname, "../../../node_modules/react-dom");

export default defineConfig({
  resolve: {
    alias: {
      react: rootReact,
      "react-dom": rootReactDom,
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    passWithNoTests: true,
  },
});
