import {
  TanStackDevtoolsCore,
  type TanStackDevtoolsPlugin,
} from "@tanstack/devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools/production";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

import { CalendarDevtoolsPanel } from "./calendar-devtools-panel";

function AppDevtools() {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const pluginRoots = new Map<HTMLElement, Root>();
    const getPluginRoot = (element: HTMLElement) => {
      const existingRoot = pluginRoots.get(element);
      if (existingRoot) {
        return existingRoot;
      }

      const root = createRoot(element);
      pluginRoots.set(element, root);
      return root;
    };

    const plugins: TanStackDevtoolsPlugin[] = [
      {
        defaultOpen: true,
        id: "tanstack-query",
        name: "TanStack Query",
        render: (element) => {
          getPluginRoot(element).render(<ReactQueryDevtoolsPanel />);
        },
      },
      {
        id: "tanstack-router",
        name: "TanStack Router",
        render: (element) => {
          getPluginRoot(element).render(<TanStackRouterDevtoolsPanel />);
        },
      },
      {
        id: "calendar-diagnostics",
        name: "Calendar Diagnostics",
        render: (element) => {
          getPluginRoot(element).render(<CalendarDevtoolsPanel />);
        },
      },
    ];

    const devtools = new TanStackDevtoolsCore({
      config: {
        defaultOpen: !import.meta.env.DEV,
        position: "bottom-right",
      },
      eventBusConfig: { debug: false },
      plugins,
    });

    devtools.mount(container);

    return () => {
      devtools.unmount();

      for (const root of pluginRoots.values()) {
        root.unmount();
      }
    };
  }, []);

  return <div ref={containerRef} />;
}

export default AppDevtools;
