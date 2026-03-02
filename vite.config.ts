import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type PluginOption } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command }) => {
  const enableDevtools =
    command === "serve" || process.env["ENABLE_DEVTOOLS"] === "true";
  const basePlugins: PluginOption[] = [
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart({
      srcDirectory: "src",
    }),
    nitro(),
    react({
      babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] },
    }),
  ];
  const plugins: PluginOption[] = enableDevtools
    ? [
        devtools({
          enhancedLogs: {
            enabled: true,
          },
          eventBusConfig: {
            debug: false,
          },
        }),
        ...basePlugins,
      ]
    : basePlugins;

  return {
    define: {
      __ENABLE_DEVTOOLS__: JSON.stringify(enableDevtools),
    },
    plugins,
  };
});
