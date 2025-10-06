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

// Helper to map a full namespaced key to its suffix key present in EventClient
type StripPrefix<K extends keyof CalendarDevtoolsEventMap> =
  K extends `custom-devtools:${infer S}` ? S : K;

class CalendarEventClient extends EventClient<CalendarDevtoolsEventMap> {
  constructor() {
    super({ pluginId: "custom-devtools" });
  }

  // Provide a typed proxy emit that accepts full namespaced key for convenience
  emitFull<K extends keyof CalendarDevtoolsEventMap>(
    fullType: K,
    payload: CalendarDevtoolsEventMap[K],
  ) {
    const parts = fullType.split(":");
    const suffix = (
      parts.length > 1 ? parts.slice(1).join(":") : parts[0]
    ) as StripPrefix<K>;
    // Cast payload to the suffix event payload type
    super.emit(
      suffix as keyof Omit<CalendarDevtoolsEventMap, keyof never>,
      payload as never,
    );
  }
}

export const CalendarDevtoolsEventClient = new CalendarEventClient();

// Emit helper (only in dev)
export function emitCalendarEvent<K extends keyof CalendarDevtoolsEventMap>(
  fullType: K,
  payload: CalendarDevtoolsEventMap[K],
) {
  if (!import.meta.env.DEV) {
    return;
  }
  CalendarDevtoolsEventClient.emitFull(fullType, payload);
}
