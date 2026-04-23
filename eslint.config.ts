/*
This file is forked from the following MIT licensed repo:
https://github.com/JoshuaKGoldberg/create-typescript-app/blob/35b86c82de893deedd884321e690336d79b4e24f/eslint.config.js
*/

import type { Linter } from "eslint";

import convexPlugin from "@convex-dev/eslint-plugin";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import eslint from "@eslint/js";
import markdown from "@eslint/markdown";
import pluginRouter from "@tanstack/eslint-plugin-router";
import tsParser from "@typescript-eslint/parser";
import vitest from "@vitest/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import jsonc from "eslint-plugin-jsonc";
import n from "eslint-plugin-n";
import packageJson from "eslint-plugin-package-json";
import perfectionist from "eslint-plugin-perfectionist";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import * as regexp from "eslint-plugin-regexp";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import yml from "eslint-plugin-yml";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

import { createNeverthrowConfigs } from "./eslint/neverthrow-plugin";

type FlatConfigEntry = Linter.Config;
type FlatConfigPlugin = NonNullable<
  NonNullable<FlatConfigEntry["plugins"]>[string]
>;
type FlatConfigRules = NonNullable<FlatConfigEntry["rules"]>;

const reactFlatRecommendedRules = (
  reactPlugin.configs.flat["recommended"] as { rules: FlatConfigRules }
).rules;
const reactFlatJsxRuntimeRules = (
  reactPlugin.configs.flat["jsx-runtime"] as { rules: FlatConfigRules }
).rules;
const reactHooksRecommendedLatestRules = (
  reactHooksPlugin.configs.flat["recommended-latest"] as {
    rules: FlatConfigRules;
  }
).rules;

export default defineConfig(
  {
    ignores: [
      "**/*.snap",
      "node_modules",
      ".agents/",
      "pnpm-lock.yaml",
      "skills-lock.json",
      "convex/_generated/",
      "src/routeTree.gen.ts",
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
  {
    extends: [
      comments.recommended,
      eslint.configs.recommended,
      convexPlugin.configs.recommended as FlatConfigEntry,
      jsdoc.configs["flat/contents-typescript-error"],
      jsdoc.configs["flat/logical-typescript-error"],
      jsdoc.configs["flat/stylistic-typescript-error"],
      n.configs["flat/recommended"],
      perfectionist.configs["recommended-natural"],
      pluginRouter.configs["flat/recommended"],
      regexp.configs["flat/recommended"],
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      eslintPluginUnicorn.configs.recommended,
    ],
    files: ["**/*.{js,ts,jsx,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin as unknown as FlatConfigPlugin,
    },
    rules: {
      ...reactFlatRecommendedRules,
      ...reactFlatJsxRuntimeRules,
      ...reactHooksRecommendedLatestRules,
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: true },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowBoolean: true, allowNullish: true, allowNumber: true },
      ],
      "jsdoc/lines-before-block": "off",
      "logical-assignment-operators": [
        "error",
        "always",
        { enforceForIfStatements: true },
      ],
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
            "URL.createObjectURL",
            "URL.revokeObjectURL",
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          message:
            "Use arkregex via `regex(...)` or shared typed regex exports instead of regex literals.",
          selector: "Literal[regex]",
        },
        {
          message:
            "Use arkregex via `regex(...)` instead of constructing `RegExp` directly.",
          selector: "CallExpression[callee.name='RegExp']",
        },
        {
          message:
            "Use arkregex via `regex(...)` instead of constructing `RegExp` directly.",
          selector: "NewExpression[callee.name='RegExp']",
        },
      ],
      "no-useless-rename": "error",
      "object-shorthand": "error",
      "operator-assignment": "error",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "unicorn/empty-brace-spaces": "off",
      "unicorn/escape-case": "off",
      "unicorn/no-nested-ternary": "off",
      "unicorn/no-null": "off",
      "unicorn/number-literal-case": "off",
      "unicorn/numeric-separators-style": "off",
      "unicorn/prefer-at": "off",
      "unicorn/prefer-logical-operator-over-ternary": "off",
      "unicorn/prefer-ternary": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/template-indent": "off",
    },
    settings: {
      perfectionist: { partitionByComment: true, type: "natural" },
      react: {
        version: "detect",
      },
      vitest: { typecheck: true },
    },
  },
  {
    extends: [jsonc.configs["flat/recommended-with-json"]],
    files: ["**/*.json"],
  },
  {
    extends: [markdown.configs.recommended],
    files: ["**/*.md"],
    rules: {
      // https://github.com/eslint/markdown/issues/294
      "markdown/no-missing-label-refs": "off",
      // ESLint core crashes on raw Markdown ASTs without this override.
      "no-irregular-whitespace": "off",
    },
  },
  {
    extends: [tseslint.configs.disableTypeChecked],
    files: ["**/*.md/*.ts"],
    rules: {
      "n/no-missing-import": "off",
    },
  },
  {
    extends: [packageJson.configs.recommended],
    files: ["package.json"],
  },
  {
    extends: [vitest.configs.recommended],
    files: ["**/*.test.*"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "unicorn/consistent-function-scoping": "off",
    },
  },
  ...createNeverthrowConfigs({
    parser: tsParser,
    tsconfigRootDir: import.meta.dirname,
  }),
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
    files: ["convex/**/*.{js,ts}"],
    rules: {
      "unicorn/filename-case": "off",
    },
  },
  {
    files: ["lib/arkregex.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/routes/**/-*.{ts,tsx}"],
    rules: {
      "unicorn/filename-case": "off",
    },
  },
);
