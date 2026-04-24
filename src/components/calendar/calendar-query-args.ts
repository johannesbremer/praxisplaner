import { Temporal } from "temporal-polyfill";

import type { Id } from "../../../convex/_generated/dataModel";

import { TIMEZONE } from "./use-calendar-logic-helpers";

export interface CalendarDayQueryArgs {
  activeRuleSetId?: Id<"ruleSets">;
  dayEnd: string;
  dayStart: string;
  locationId?: Id<"locations">;
  practiceId: Id<"practices">;
  scope: CalendarQueryScope;
  selectedRuleSetId?: Id<"ruleSets">;
}

export type CalendarQueryScope = "all" | "real" | "simulation";

export function buildCalendarDayQueryArgs(args: {
  activeRuleSetId: Id<"ruleSets"> | undefined;
  locationId: Id<"locations"> | undefined;
  practiceId: Id<"practices"> | undefined;
  ruleSetId: Id<"ruleSets"> | undefined;
  scope: CalendarQueryScope;
  selectedDate: Temporal.PlainDate;
}): CalendarDayQueryArgs | null {
  if (!args.practiceId) {
    return null;
  }

  const { dayEnd, dayStart } = buildCalendarDayRange(args.selectedDate);

  return {
    ...(args.activeRuleSetId && { activeRuleSetId: args.activeRuleSetId }),
    dayEnd,
    dayStart,
    ...(args.locationId && { locationId: args.locationId }),
    practiceId: args.practiceId,
    scope: args.scope,
    ...(args.ruleSetId && { selectedRuleSetId: args.ruleSetId }),
  };
}

export function buildCalendarDayRange(selectedDate: Temporal.PlainDate): {
  dayEnd: string;
  dayStart: string;
} {
  const dayStart = selectedDate.toZonedDateTime({
    plainTime: Temporal.PlainTime.from("00:00"),
    timeZone: TIMEZONE,
  });

  return {
    dayEnd: dayStart.add({ days: 1 }).toString(),
    dayStart: dayStart.toString(),
  };
}
