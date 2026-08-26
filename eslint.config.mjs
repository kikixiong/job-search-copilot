import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "node_modules/**", "release/**", ".superpowers/**", "**/*.tsbuildinfo"]
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: ["packages/viewer/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended]
  }
);
