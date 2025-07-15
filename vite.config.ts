import { tanstackStart } from "@tanstack/react-start-plugin";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
    react(),
    tanstackStart({
      customViteReactPlugin: true,
      tsr: {
        srcDirectory: "src",
      },
    }),
    visualizer({
      filename: "bundle-analysis.json",
      template: "raw-data",
    }),
  ],
});
