import { globSync } from "node:fs";
import { defineConfig } from "vitest/config";

import PropertyProgressReporter from "./src/tests/property-progress-reporter";

const PROPERTY_TEST_INCLUDE = ["**/*.property.test.ts"];
const PROPERTY_TEST_EXCLUDE = [
  "**/node_modules/**",
  "**/playwright/**",
  "**/*.spec.ts",
];

const propertyTestFileCount = globSync(PROPERTY_TEST_INCLUDE, {
  cwd: process.cwd(),
  exclude: PROPERTY_TEST_EXCLUDE,
}).length;
const propertyWorkerCount =
  parsePositiveIntegerEnv("FAST_CHECK_MAX_WORKERS") ?? propertyTestFileCount;

export default defineConfig({
  define: {
    __ENABLE_DEVTOOLS__: "false",
  },
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    coverage: {
      exclude: [
        "node_modules/",
        "src/tests/",
        "**/*.config.*",
        "**/routeTree.gen.ts",
        "convex/_generated/",
      ],
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    environment: "node",
    exclude: PROPERTY_TEST_EXCLUDE,
    fileParallelism: true,
    globals: true,
    include: PROPERTY_TEST_INCLUDE,
    maxWorkers: propertyWorkerCount,
    reporters: [new PropertyProgressReporter()],
    testTimeout: 0,
  },
});

function parsePositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }

  return parsed;
}
