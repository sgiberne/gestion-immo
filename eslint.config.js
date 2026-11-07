import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", "data/", "node_modules/"] },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Interface (navigateur) et serveur (Node)
  { files: ["src/**/*.ts"], languageOptions: { globals: globals.browser } },
  { files: ["server/**/*.ts", "*.config.{js,ts}"], languageOptions: { globals: globals.node } },

  // Règles qui ont besoin des types : promesses oubliées ou mal utilisées
  {
    files: ["src/**/*.ts", "server/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },

  // `any` accepté là où l'on manipule du JSON non typé : réponses d'API dans les tests, et validation/import
  // des données envoyées par le client (contrôlées champ par champ).
  {
    files: ["**/*.test.ts", "server/fixtures/**", "server/validation.ts", "server/importExport.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },

  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
);
