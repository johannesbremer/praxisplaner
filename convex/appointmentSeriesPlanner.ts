import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { AppointmentOccupancyScope } from "./appointmentOccupancy";
import type { AppointmentTypeLineageKey, LocationLineageKey } from "./identity";
import type { ZonedDateTimeString } from "./typedDtos";

import {
  appointmentOccupancyScopeValidator,
  type CalendarResourceColumn,
  calendarResourceColumnValidator,
} from "./appointmentOccupancy";

export const appointmentSeriesPlanningFailureKindValidator = v.union(
  v.literal("appointmentOccupancy"),
  v.literal("blockedSlot"),
  v.literal("ruleBlock"),
  v.literal("schedulerUnavailable"),
  v.literal("seriesInternalConflict"),
  v.literal("seriesStepUnavailable"),
);

export type AppointmentSeriesPlanningFailureKind =
  | "appointmentOccupancy"
  | "blockedSlot"
  | "ruleBlock"
  | "schedulerUnavailable"
  | "seriesInternalConflict"
  | "seriesStepUnavailable";

export interface BlockedSeriesPlanningResult {
  blockedStepEnd?: ZonedDateTimeString;
  blockedStepId: string;
  blockedStepStart?: ZonedDateTimeString;
  blockingBlockedSlotId?: Id<"blockedSlots">;
  blockingRuleIds?: Id<"ruleConditions">[];
  failureKind: AppointmentSeriesPlanningFailureKind;
  failureMessage: string;
  status: "blocked";
  steps: PlannedSeriesStep[];
}

export interface PlannedSeriesStep {
  appointmentTypeId: Id<"appointmentTypes">;
  appointmentTypeLineageKey: AppointmentTypeLineageKey;
  appointmentTypeTitle: string;
  calendarResourceColumn?: CalendarResourceColumn;
  durationMinutes: number;
  end: ZonedDateTimeString;
  locationId: Id<"locations">;
  locationLineageKey: LocationLineageKey;
  note?: string;
  occupancyScope: AppointmentOccupancyScope;
  practitionerId?: Id<"practitioners">;
  practitionerName?: string;
  seriesStepIndex: number;
  start: ZonedDateTimeString;
  stepId: string;
}

export interface ReadySeriesPlanningResult {
  status: "ready";
  steps: PlannedSeriesStep[];
}

export type SeriesPlanningResult =
  | BlockedSeriesPlanningResult
  | ReadySeriesPlanningResult;

export const appointmentSeriesPreviewStepValidator = v.object({
  appointmentTypeId: v.id("appointmentTypes"),
  appointmentTypeLineageKey: v.id("appointmentTypes"),
  appointmentTypeTitle: v.string(),
  calendarResourceColumn: v.optional(calendarResourceColumnValidator),
  durationMinutes: v.number(),
  end: v.string(),
  locationId: v.id("locations"),
  locationLineageKey: v.id("locations"),
  note: v.optional(v.string()),
  occupancyScope: appointmentOccupancyScopeValidator,
  practitionerId: v.optional(v.id("practitioners")),
  practitionerName: v.optional(v.string()),
  seriesStepIndex: v.number(),
  start: v.string(),
  stepId: v.string(),
});

export const appointmentSeriesPreviewResultValidator = v.object({
  blockedStepEnd: v.optional(v.string()),
  blockedStepId: v.optional(v.string()),
  blockedStepStart: v.optional(v.string()),
  blockingBlockedSlotId: v.optional(v.id("blockedSlots")),
  blockingRuleIds: v.optional(v.array(v.id("ruleConditions"))),
  failureKind: v.optional(appointmentSeriesPlanningFailureKindValidator),
  failureMessage: v.optional(v.string()),
  status: v.union(v.literal("blocked"), v.literal("ready")),
  steps: v.array(appointmentSeriesPreviewStepValidator),
});
