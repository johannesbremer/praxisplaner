import { v } from "convex/values";

import type {
  CalendarResourceColumn,
  AppointmentOccupancyScope as SharedAppointmentOccupancyScope,
  BlockedSlotOccupancyScope as SharedBlockedSlotOccupancyScope,
  CalendarOccupancyScope as SharedCalendarOccupancyScope,
} from "../lib/calendar-occupancy";
import type { Id } from "./_generated/dataModel";
export type { CalendarResourceColumn } from "../lib/calendar-occupancy";
import {
  blockedSlotOccupancyScopeFromPractitioner,
  isPractitionerOccupancyScope,
  isResourceOccupancyScope,
} from "../lib/calendar-occupancy";

export type AppointmentOccupancyScope = SharedAppointmentOccupancyScope<
  Id<"practitioners">
>;
export type BlockedSlotOccupancyScope = SharedBlockedSlotOccupancyScope<
  Id<"practitioners">
>;
export type CalendarOccupancyScope = SharedCalendarOccupancyScope<
  Id<"practitioners">
>;

export const calendarResourceColumnValidator = v.union(
  v.literal("ekg"),
  v.literal("labor"),
);

export const appointmentOccupancyScopeValidator = v.union(
  v.object({
    kind: v.literal("practitioner"),
    practitionerLineageKey: v.id("practitioners"),
  }),
  v.object({
    calendarResourceColumn: calendarResourceColumnValidator,
    kind: v.literal("resource"),
  }),
);

export const calendarOccupancyScopeValidator = v.union(
  appointmentOccupancyScopeValidator,
  v.object({
    kind: v.literal("location-wide"),
  }),
);

export const blockedSlotOccupancyScopeValidator = v.union(
  v.object({
    kind: v.literal("practitioner"),
    practitionerLineageKey: v.id("practitioners"),
  }),
  v.object({
    calendarResourceColumn: calendarResourceColumnValidator,
    kind: v.literal("resource"),
  }),
);

export function appointmentOccupancyScopeFromRefs(args: {
  calendarResourceColumn?: CalendarResourceColumn | undefined;
  practitionerLineageKey?: Id<"practitioners"> | undefined;
}): AppointmentOccupancyScope {
  if (
    args.practitionerLineageKey !== undefined &&
    args.calendarResourceColumn !== undefined
  ) {
    throw new Error(
      "Appointments must use either a practitioner or a resource column, not both.",
    );
  }

  if (args.practitionerLineageKey !== undefined) {
    return {
      kind: "practitioner",
      practitionerLineageKey: args.practitionerLineageKey,
    };
  }

  if (args.calendarResourceColumn !== undefined) {
    return {
      calendarResourceColumn: args.calendarResourceColumn,
      kind: "resource",
    };
  }

  throw new Error(
    "Appointments must use either a practitioner or a resource column.",
  );
}

export function blockedSlotOccupancyScopeFromPractitionerRef(
  practitionerLineageKey: Id<"practitioners">,
): BlockedSlotOccupancyScope {
  return blockedSlotOccupancyScopeFromPractitioner(practitionerLineageKey);
}

export function getAppointmentCalendarResourceColumn(
  scope: AppointmentOccupancyScope | undefined,
): CalendarResourceColumn | undefined {
  return scope !== undefined && isResourceOccupancyScope(scope)
    ? scope.calendarResourceColumn
    : undefined;
}

export function getAppointmentPractitionerLineageKey(
  scope: AppointmentOccupancyScope | undefined,
): Id<"practitioners"> | undefined {
  return scope !== undefined && isPractitionerOccupancyScope(scope)
    ? scope.practitionerLineageKey
    : undefined;
}

export function getBlockedSlotCalendarResourceColumn(
  scope: BlockedSlotOccupancyScope | undefined,
): CalendarResourceColumn | undefined {
  return scope !== undefined && isResourceOccupancyScope(scope)
    ? scope.calendarResourceColumn
    : undefined;
}

export function getBlockedSlotPractitionerLineageKey(
  scope: BlockedSlotOccupancyScope | undefined,
): Id<"practitioners"> | undefined {
  return scope !== undefined && isPractitionerOccupancyScope(scope)
    ? scope.practitionerLineageKey
    : undefined;
}
