import { EventClient } from "@tanstack/devtools-event-client";

// Event payload definitions for calendar diagnostics
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

export const CalendarDevtoolsEventClient = new CalendarEventClient();

// Emit helper for calendar diagnostics when devtools are enabled.
export function emitCalendarEvent<K extends keyof CalendarDevtoolsEventMap>(
  fullType: K,
  payload: CalendarDevtoolsEventMap[K],
) {
  if (!__ENABLE_DEVTOOLS__) {
    return;
  }
  CalendarDevtoolsEventClient.emitFull(fullType, payload);
}
