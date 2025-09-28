import { EventClient } from "@tanstack/devtools-event-client";

interface EventMap {
  "query-devtools:init": {
    description: string;
    title: string;
  };
  "query-devtools:query": {
    description: string;
    title: string;
  };
  "query-devtools:test": {
    description: string;
    title: string;
  };
}

class QueryDevtoolsClient extends EventClient<EventMap> {
  constructor() {
    super({
      debug: false,
      pluginId: "query-devtools",
    });
  }
}

export const queryPlugin = new QueryDevtoolsClient();

// this should be queued and emitted when bus is available
queryPlugin.emit("test", {
  description: "A plugin for query debugging",
  title: "Query Devtools",
});
