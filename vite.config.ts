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
    tanstackStart({
      customViteReactPlugin: true,
      target: "vercel",
      tsr: {
        srcDirectory: "src",
      },
    }),
    react({
      babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] },
    }),
    visualizer({
      filename: "bundle-analysis.json",
      template: "raw-data",
    }),
  ],
});
