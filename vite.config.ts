import babel from "@rolldown/plugin-babel";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type PluginOption } from "vite";

export default defineConfig(({ command }) => {
  const enableDevtoolsRuntime =
    command === "serve" || process.env["ENABLE_DEVTOOLS"] === "true";
  const enableDevtoolsVitePlugin = command === "serve";
  const basePlugins: PluginOption[] = [
    tanstackStart({
      srcDirectory: "src",
    }),
    nitro(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ];
  const plugins: PluginOption[] = enableDevtoolsVitePlugin
    ? [
        devtools({
          enhancedLogs: {
            enabled: true,
          },
          eventBusConfig: {
            debug: false,
          },
          removeDevtoolsOnBuild: false,
        }),
        ...basePlugins,
      ]
    : basePlugins;

  return {
    define: {
      __ENABLE_DEVTOOLS__: JSON.stringify(enableDevtoolsRuntime),
    },
    plugins,
    resolve: {
      tsconfigPaths: true,
    },
  };
});
