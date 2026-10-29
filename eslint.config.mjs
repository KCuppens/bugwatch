import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/.next/",
      "**/target/",
      "**/.source/",
      // tsup writes a transient bundled-config file while building; when lint
      // runs concurrently with build (turbo), eslint can glob it then fail to
      // open it after tsup deletes it (ENOENT). Never lint these temp files.
      "**/tsup.config.bundled_*.mjs",
    ],
  },
  {
    rules: {
      // Allow intentionally-unused identifiers when prefixed with `_`.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
    },
  }
);
