import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "coverage/**", ".tmp/**", ".direnv/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["scripts/**/*.mjs", "eslint.config.js"], languageOptions: { globals: globals.node } },
  {
    files: ["src/domain/**/*.ts"],
    ignores: ["src/domain/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\./)",
              message: "Domain must not depend on adapters or third-party libraries.",
            },
          ],
        },
      ],
    },
  },
);
