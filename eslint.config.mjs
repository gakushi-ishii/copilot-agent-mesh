import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Disallow `any` — the core goal of this ESLint setup
      "@typescript-eslint/no-explicit-any": "warn",
      // Prefer `unknown` in catch clauses
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow empty catch blocks only with a comment
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "src/__tests__/"],
  },
);
