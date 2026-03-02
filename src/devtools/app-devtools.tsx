import { TanStackDevtools } from "@tanstack/react-devtools";
import { hotkeysDevtoolsPlugin } from "@tanstack/react-hotkeys-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { CalendarDevtoolsPanel } from "./calendar-devtools-panel";

export function AppDevtools() {
  return (
    <TanStackDevtools
      eventBusConfig={{ debug: false }}
      plugins={[
        hotkeysDevtoolsPlugin(),
        {
          name: "TanStack Query",
          render: <ReactQueryDevtoolsPanel />,
        },
        {
          name: "TanStack Router",
          render: <TanStackRouterDevtoolsPanel />,
        },
        {
          name: "Calendar Diagnostics",
          render: <CalendarDevtoolsPanel />,
        },
      ]}
    />
  );
}

export default AppDevtools;
