import { EventClient } from "@tanstack/devtools-event-client";

export interface CalendarDevtoolsEventMap {
  "custom-devtools:calendar-appointments": {
    count: number;
    diff: { added: string[]; removed: string[]; updated: string[] };
    lastChangeAt: number;
  };
  "custom-devtools:calendar-autoscroll": {
    active: boolean;
    direction?: "down" | "up";
    intervalActive: boolean;
  };
  "custom-devtools:calendar-drag": {
    column?: string;
    dragging: boolean;
    slotIndex?: number;
  };
  "custom-devtools:calendar-effect": { count: number; name: string };
  "custom-devtools:calendar-performance": {
    lastCommitAt: number;
    renderDeltaMs: number;
    sinceMountMs: number;
  };
  "custom-devtools:calendar-render": { lastRenderAt: number; renders: number };
}

let calendarEventClient: CalendarEventClient | null = null;

class CalendarEventClient extends EventClient<CalendarDevtoolsEventMap> {
  constructor() {
    super({ pluginId: "custom-devtools" });
  }

  emitFull<K extends keyof CalendarDevtoolsEventMap>(
    fullType: K,
    payload: CalendarDevtoolsEventMap[K],
  ) {
    super.emit(fullType, payload);
  }
}

function getCalendarEventClient() {
  if (!__ENABLE_DEVTOOLS__ || !isClientEnvironment()) {
    return null;
  }

  calendarEventClient ??= new CalendarEventClient();
  return calendarEventClient;
}

function isClientEnvironment() {
  return !import.meta.env.SSR;
}

export const CalendarDevtoolsEventClient = {
  emitFull<K extends keyof CalendarDevtoolsEventMap>(
    fullType: K,
    payload: CalendarDevtoolsEventMap[K],
  ) {
    getCalendarEventClient()?.emitFull(fullType, payload);
  },
  on<K extends keyof CalendarDevtoolsEventMap>(
    fullType: K,
    listener: (event: { payload: CalendarDevtoolsEventMap[K] }) => void,
  ) {
    const client = getCalendarEventClient();
    if (!client) {
      return () => 0;
    }

    return client.on(fullType, listener);
  },
};

export function emitCalendarEvent<K extends keyof CalendarDevtoolsEventMap>(
  fullType: K,
  payload: CalendarDevtoolsEventMap[K],
) {
  if (!__ENABLE_DEVTOOLS__) {
    return;
  }

  CalendarDevtoolsEventClient.emitFull(fullType, payload);
}
