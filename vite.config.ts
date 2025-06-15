import { tanstackStart } from "@tanstack/react-start-plugin";
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
    visualizer({
      filename: "bundle-analysis.json",
      template: "raw-data",
    }),
  ],
});
