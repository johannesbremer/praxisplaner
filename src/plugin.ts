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

let queryPluginClient: null | QueryDevtoolsClient = null;

function getQueryPluginClient() {
  if (!isClientEnvironment()) {
    return null;
  }

  queryPluginClient ??= new QueryDevtoolsClient();
  return queryPluginClient;
}

function isClientEnvironment() {
  return !import.meta.env.SSR;
}

export const queryPlugin = {
  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]) {
    getQueryPluginClient()?.emit(type, payload);
  },
};

if (isClientEnvironment()) {
  queryPlugin.emit("query-devtools:test", {
    description: "A plugin for query debugging",
    title: "Query Devtools",
  });
}
