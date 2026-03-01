import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs,ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.node
      },
      sourceType: "module"
    }
  },
  eslintConfigPrettier
);
