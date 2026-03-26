import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __ENABLE_DEVTOOLS__: "false",
  },
  plugins: [react()],
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
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/playwright/**", "**/*.spec.ts"],
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
  },
});
