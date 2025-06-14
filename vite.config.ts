import { tanstackStart } from "@tanstack/react-start-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart({
      tsr: {
        srcDirectory: "src",
      },
    }),
    tanstackRouter({
      autoCodeSplitting: true,
    }),
    react(),
    visualizer({
      filename: "bundle-analysis.json",
      template: "raw-data",
    }),
  ],
});
