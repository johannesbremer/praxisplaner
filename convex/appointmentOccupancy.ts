import type { Infer } from "convex/values";

import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

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

export type AppointmentOccupancyScope = Infer<
  typeof appointmentOccupancyScopeValidator
>;
export type CalendarOccupancyScope = Infer<
  typeof calendarOccupancyScopeValidator
>;
export type CalendarResourceColumn = Infer<
  typeof calendarResourceColumnValidator
>;

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

export function getAppointmentCalendarResourceColumn(
  scope: AppointmentOccupancyScope | undefined,
): CalendarResourceColumn | undefined {
  return scope?.kind === "resource" ? scope.calendarResourceColumn : undefined;
}

export function getAppointmentPractitionerLineageKey(
  scope: AppointmentOccupancyScope | undefined,
): Id<"practitioners"> | undefined {
  return scope?.kind === "practitioner"
    ? scope.practitionerLineageKey
    : undefined;
}
