import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Browser apps
  {
    files: [
      "apps/browser-extension/**/*.{ts,js}",
      "apps/electron-client/src/renderer/**/*.{ts,js}",
      "apps/web-dashboard/**/*.{ts,js}"
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Node apps (server + electron main)
  {
    files: [
      "apps/server/**/*.{ts,js}",
      "apps/electron-client/src/main/**/*.{ts,js}",
      "apps/electron-client/src/preload/**/*.{ts,js}"
    ],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];