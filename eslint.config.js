/*
This is a fork of the following MIT licensed repo:
https://github.com/JoshuaKGoldberg/create-typescript-app/blob/35b86c82de893deedd884321e690336d79b4e24f/eslint.config.js
*/

import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import jsonc from "eslint-plugin-jsonc";
import markdown from "eslint-plugin-markdown";
import n from "eslint-plugin-n";
import packageJson from "eslint-plugin-package-json";
import perfectionist from "eslint-plugin-perfectionist";
import * as regexp from "eslint-plugin-regexp";
import yml from "eslint-plugin-yml";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/*.snap",
      "coverage",
      "lib",
      "node_modules",
      "pnpm-lock.yaml",
      "convex/_generated/",
      "src/routeTree.gen.ts",
      "eslint.config.js",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  eslint.configs.recommended,
  comments.recommended,
  jsdoc.configs["flat/contents-typescript-error"],
  jsdoc.configs["flat/logical-typescript-error"],
  jsdoc.configs["flat/stylistic-typescript-error"],
  jsonc.configs["flat/recommended-with-json"],
  markdown.configs.recommended,
  n.configs["flat/recommended"],
  packageJson.configs.recommended,
  perfectionist.configs["recommended-natural"],
  regexp.configs["flat/recommended"],
  {
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    files: ["**/*.{js,ts}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["bin/index.js"],
        },
        tsconfigRootDir: ".",
      },
    },
    rules: {
      // These on-by-default rules work well for this repo if configured
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: true },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowBoolean: true, allowNullish: true, allowNumber: true },
      ],

      // Stylistic concerns that don't interfere with Prettier
      "logical-assignment-operators": [
        "error",
        "always",
        { enforceForIfStatements: true },
      ],
      "no-useless-rename": "error",
      "object-shorthand": "error",
      "operator-assignment": "error",
    },
    settings: {
      perfectionist: { partitionByComment: true, type: "natural" },
      vitest: { typecheck: true },
    },
  },
  {
    extends: [tseslint.configs.disableTypeChecked],
    files: ["**/*.md/*.ts"],
    rules: { "n/no-missing-import": "off" },
  },
  {
    extends: [vitest.configs.recommended],
    files: ["**/*.test.*"],
    rules: { "@typescript-eslint/no-unsafe-assignment": "off" },
  },
  {
    extends: [yml.configs["flat/standard"], yml.configs["flat/prettier"]],
    files: ["**/*.{yml,yaml}"],
    rules: {
      "yml/file-extension": ["error", { extension: "yml" }],
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
);
