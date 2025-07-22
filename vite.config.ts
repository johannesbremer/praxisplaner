import { tanstackStart } from "@tanstack/react-start-plugin";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const isTest = mode === "test";

  return {
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
      // Only add polyfills when not testing
      ...(isTest
        ? []
        : [
            nodePolyfills({
              // Only polyfill for client-side, not SSR
              globals: {
                process: true,
              },
              include: ["process"],
            }),
          ]),
      visualizer({
        filename: "bundle-analysis.json",
        template: "raw-data",
      }),
    ],
    // Only add define when not testing
    ...(isTest
      ? {}
      : {
          define: {
            "process.argv": [], // Mock an empty argument list
            "process.env": {}, // Mock environment variables
            "process.platform": '"browser"', // Mock platform as 'browser'
          },
        }),
  };
});
