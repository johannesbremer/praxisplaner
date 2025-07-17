import { tanstackStart } from "@tanstack/react-start-plugin";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => ({
  define:
    mode === "test"
      ? {}
      : {
          // Define process polyfill for browser compatibility (but not for tests)
          global: "globalThis",
          "process.argv": "[]",
          "process.env": "{}",
          "process.platform": '"browser"',
        },
  optimizeDeps: {
    include: ["commit-graph"],
  },
  plugins: [
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart({
      customViteReactPlugin: true,
      tsr: {
        srcDirectory: "src",
      },
    }),
    react(),
    visualizer({
      filename: "bundle-analysis.json",
      template: "raw-data",
    }),
  ],
}));
