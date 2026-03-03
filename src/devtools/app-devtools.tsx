import {
  TanStackDevtoolsCore,
  type TanStackDevtoolsPlugin,
} from "@tanstack/devtools";
import { useQueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools/production";
import { useRouter } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanelInProd } from "@tanstack/react-router-devtools";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

import { CalendarDevtoolsPanel } from "./calendar-devtools-panel";

function AppDevtools() {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter({ warn: false });

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
          getPluginRoot(element).render(
            <ReactQueryDevtoolsPanel client={queryClient} />,
          );
        },
      },
      {
        id: "tanstack-router",
        name: "TanStack Router",
        render: (element) => {
          getPluginRoot(element).render(
            <TanStackRouterDevtoolsPanelInProd router={router} />,
          );
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
        defaultOpen: false,
        position: "bottom-left",
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
  }, [queryClient, router]);

  return <div ref={containerRef} />;
}

export default AppDevtools;
