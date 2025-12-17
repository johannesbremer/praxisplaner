/*
This file is forked from the following MIT licensed repo:
https://github.com/JoshuaKGoldberg/create-typescript-app/blob/35b86c82de893deedd884321e690336d79b4e24f/eslint.config.js
*/

import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import convexPlugin from "@convex-dev/eslint-plugin";
import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import jsonc from "eslint-plugin-jsonc";
import n from "eslint-plugin-n";
import packageJson from "eslint-plugin-package-json";
import perfectionist from "eslint-plugin-perfectionist";
import pluginRouter from "@tanstack/eslint-plugin-router";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import * as regexp from "eslint-plugin-regexp";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import yml from "eslint-plugin-yml";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/*.snap",
      "node_modules",
      "pnpm-lock.yaml",
      "convex/_generated/",
      "src/routeTree.gen.ts",
      "eslint.config.js",
      ".output",
      ".nitro",
      ".tanstack",
      "dist",
      ".github/instructions/convex.instructions.md",
      ".vercel/",
      "test-results/",
      "playwright-report/",
      "blob-report/",
      "playwright/.cache/",
      "playwright/.auth/",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  eslint.configs.recommended,
  comments.recommended,
  convexPlugin.configs.recommended,
  jsdoc.configs["flat/contents-typescript-error"],
  jsdoc.configs["flat/logical-typescript-error"],
  jsdoc.configs["flat/stylistic-typescript-error"],
  jsonc.configs["flat/recommended-with-json"],
  n.configs["flat/recommended"],
  packageJson.configs.recommended,
  perfectionist.configs["recommended-natural"],
  pluginRouter.configs["flat/recommended"],
  regexp.configs["flat/recommended"],
  eslintPluginUnicorn.configs.recommended,
  {
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    files: ["**/*.{js,ts,jsx,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      // React rules for TypeScript files
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat["jsx-runtime"].rules,
      ...reactHooksPlugin.configs.flat["recommended-latest"].rules,
      "react/prop-types": "off", // We're using TypeScript
      "react/react-in-jsx-scope": "off", // Not needed with React 17+ JSX transform
      "react/jsx-uses-react": "off", // Not needed with React 17+ JSX transform
      "react/jsx-uses-vars": "error",

      // Unicorn rules adjustments
      "unicorn/prefer-at": "off", // Conflicts with Node.js version requirements
      "unicorn/no-null": "off", // Many APIs and existing code uses null consistently
      "unicorn/prevent-abbreviations": "off", // Abbreviations are common in this codebase

      // Formatting-related rules that may conflict with Prettier
      "unicorn/empty-brace-spaces": "off", // Conflicts with Prettier's brace spacing
      "unicorn/number-literal-case": "off", // Conflicts with Prettier's number formatting
      "unicorn/numeric-separators-style": "off", // Conflicts with Prettier's number formatting
      "unicorn/escape-case": "off", // Conflicts with Prettier's escape sequence formatting
      "unicorn/template-indent": "off", // Conflicts with Prettier's template literal formatting
      "unicorn/prefer-ternary": "off", // Can conflict with Prettier's ternary formatting
      "unicorn/prefer-logical-operator-over-ternary": "off", // Can conflict with Prettier's operator formatting
      "unicorn/no-nested-ternary": "off", // Conflicts with Prettier's ternary formatting
      "jsdoc/lines-before-block": "off", // Conflicts with Prettier's blank line handling

      // These on-by-default rules work well for this repo if configured
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: true },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowBoolean: true, allowNullish: true, allowNumber: true },
      ],
      "@typescript-eslint/no-floating-promises": "error",

      // Stylistic concerns that don't interfere with Prettier
      "logical-assignment-operators": [
        "error",
        "always",
        { enforceForIfStatements: true },
      ],
      "n/no-unsupported-features/node-builtins": [
        "error",
        {
          ignores: [
            "File",
            "WritableStream",
            "Blob",
            "CustomEvent",
            "DOMException",
            "localStorage",
            "crypto",
          ],
        },
      ],
      "no-useless-rename": "error",
      "object-shorthand": "error",
      "operator-assignment": "error",
      "n/no-missing-import": [
        "error",
        {
          tryExtensions: [
            ".js",
            ".jsx",
            ".json",
            ".node",
            ".ts",
            ".tsx",
            ".d.ts",
          ],
        },
      ],
    },
    settings: {
      perfectionist: { partitionByComment: true, type: "natural" },
      vitest: { typecheck: true },
      react: {
        version: "detect", // Automatically detect React version
      },
    },
  },
  {
    extends: [vitest.configs.recommended],
    files: ["**/*.test.*"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "unicorn/consistent-function-scoping": "off",
    },
  },
  {
    extends: [yml.configs["flat/standard"], yml.configs["flat/prettier"]],
    files: ["**/*.{yml,yaml}"],
    rules: {
      "yml/file-extension": ["error", { extension: "yaml" }],
      "yml/sort-keys": [
        "error",
        { order: { type: "asc" }, pathPattern: "^.*$" },
      ],
      "yml/sort-sequence-values": [
        "error",
        { order: { type: "asc" }, pathPattern: "^.*$" },
      ],
    },
  },
  {
    // Allow camelCase filenames in Convex directory
    files: ["convex/**/*.{js,ts}"],
    rules: {
      "unicorn/filename-case": "off",
    },
  },
);
