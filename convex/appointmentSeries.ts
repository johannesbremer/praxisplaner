import { ConvexError, v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { InstantString, IsoDateString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { InternalSchedulingResultSlot } from "./scheduling";
import type { AppointmentColor, AppointmentSmiley } from "./schema";
import type { ZonedDateTimeString } from "./typedDtos";

import { internal } from "./_generated/api";
import { resolveAppointmentColorForType } from "./appointmentColors";
import {
  type AppointmentBookingScope,
  appointmentOverlapsCandidate,
  findConflictingAppointment,
  getOccupancyViewForBookingScope,
} from "./appointmentConflicts";
import {
  type AppointmentOccupancyScope,
  appointmentOccupancyScopeFromRefs,
  appointmentOccupancyScopeValidator,
  type CalendarResourceColumn,
  calendarResourceColumnValidator,
  getAppointmentPractitionerLineageKey,
} from "./appointmentOccupancy";
import {
  type AppointmentPlanOccupancy,
  type AppointmentPlanStep,
  type AppointmentPlanTiming,
  type AppointmentTypeDefaultOccupancy,
  normalizeAppointmentPlan,
  normalizeDefaultOccupancy,
  requireAppointmentTypeByLineageKey,
} from "./appointmentPlans";
import {
  resolveLocationLineageKey,
  resolveOccupancyReferenceLineageKeys,
  resolvePractitionerLineageKey,
} from "./appointmentReferences";
import {
  type AppointmentTypeLineageKey,
  asAppointmentTypeLineageKey,
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
  type LocationLineageKey,
} from "./identity";
import { requireLineageKey } from "./lineage";
import { isPublicHoliday } from "./publicHolidays";
import {
  asInstantString,
  asIsoDateString,
  asOptionalIsoDateString,
  asZonedDateTimeString,
} from "./typedDtos";

const MAX_SERIES_SEARCH_DAYS = 370;

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
  blockedStepId: v.optional(v.string()),
  failureMessage: v.optional(v.string()),
  status: v.union(v.literal("blocked"), v.literal("ready")),
  steps: v.array(appointmentSeriesPreviewStepValidator),
});

export const appointmentSeriesCreatedStepValidator = v.object({
  appointmentId: v.id("appointments"),
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

export const appointmentSeriesCreateResultValidator = v.object({
  appointmentIds: v.array(v.id("appointments")),
  rootAppointmentId: v.id("appointments"),
  seriesId: v.string(),
  steps: v.array(appointmentSeriesCreatedStepValidator),
});

export const appointmentSeriesArgsValidator = {
  bookingIdentityId: v.optional(v.id("bookingIdentities")),
  calendarResourceColumn: v.optional(calendarResourceColumnValidator),
  isNewPatient: v.optional(v.boolean()),
  locationId: v.id("locations"),
  patientDateOfBirth: v.optional(v.string()),
  patientId: v.optional(v.id("patients")),
  practiceId: v.id("practices"),
  practitionerId: v.optional(v.id("practitioners")),
  rootAppointmentTypeId: v.id("appointmentTypes"),
  ruleSetId: v.id("ruleSets"),
  scope: v.optional(v.union(v.literal("real"), v.literal("simulation"))),
  simulationRuleSetId: v.optional(v.id("ruleSets")),
  start: v.string(),
  userId: v.optional(v.id("users")),
};

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

interface ResolvedPlanOccupancy {
  calendarResourceColumn?: CalendarResourceColumn;
  occupancyScope: AppointmentOccupancyScope;
  practitionerId?: Id<"practitioners">;
  practitionerName?: string;
}

interface RootSeriesCandidate {
  calendarResourceColumn?: CalendarResourceColumn;
  excludedAppointmentIds?: Id<"appointments">[];
  isNewPatient?: boolean;
  locationId: Id<"locations">;
  patientDateOfBirth?: IsoDateString;
  patientId?: Id<"patients">;
  practiceId: Id<"practices">;
  practitionerId?: Id<"practitioners">;
  scope?: AppointmentBookingScope;
  simulationRuleSetId?: Id<"ruleSets">;
  start: ZonedDateTimeString;
  title?: string;
  userId?: Id<"users">;
}

type SeriesPlannerCtx =
  | Pick<MutationCtx, "db" | "runQuery">
  | Pick<QueryCtx, "db" | "runQuery">;

interface SeriesPlanningResult {
  blockedStepId?: string;
  failureMessage?: string;
  status: "blocked" | "ready";
  steps: PlannedSeriesStep[];
}

interface SeriesPlanningState {
  baseSchedulesByRuleSet: Map<Id<"ruleSets">, Promise<Doc<"baseSchedules">[]>>;
  eligibleWeekdays: Map<string, number[]>;
  slotCache: Map<string, InternalSchedulingResultSlot[]>;
}

interface SeriesSpecification {
  appointmentPlanSnapshot: AppointmentPlanStep[];
  rootAppointmentType: Doc<"appointmentTypes">;
  rootDurationMinutes: number;
  ruleSetId: Id<"ruleSets">;
}

export async function createAppointmentSeries(
  ctx: MutationCtx,
  args: {
    bookingIdentityId?: Id<"bookingIdentities">;
    calendarResourceColumn?: CalendarResourceColumn;
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    rootAppointmentTypeId: Id<"appointmentTypes">;
    rootColor?: AppointmentColor;
    rootReplacesAppointmentId?: Id<"appointments">;
    rootSmiley?: AppointmentSmiley;
    rootTitle: string;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: ZonedDateTimeString;
    userId?: Id<"users">;
  },
) {
  const rootAppointmentType = await loadRootAppointmentType(ctx, {
    practiceId: args.practiceId,
    rootAppointmentTypeId: args.rootAppointmentTypeId,
    ruleSetId: args.ruleSetId,
  });
  const planningState = createSeriesPlanningState();
  const preview = await previewAppointmentSeries(
    ctx,
    {
      ...(args.rootReplacesAppointmentId && {
        excludedAppointmentIds: [args.rootReplacesAppointmentId],
      }),
      ...args,
      rootAppointmentTypeId: rootAppointmentType._id,
    },
    planningState,
  );

  if (preview.status === "blocked") {
    throw appointmentSeriesError(
      "FOLLOW_UP_SLOT_UNAVAILABLE",
      preview.failureMessage ||
        "Die Kettentermine konnten nicht vollständig geplant werden.",
    );
  }

  const now = BigInt(Date.now());
  const seriesId = createSeriesId();
  const appointmentIds: Id<"appointments">[] = [];
  const createdSteps: (PlannedSeriesStep & {
    appointmentId: Id<"appointments">;
  })[] = [];
  const scope = args.scope ?? "real";
  const simulationRuleSetId = resolveSeriesSimulationRuleSetId({
    ruleSetId: args.ruleSetId,
    scope,
    ...(args.simulationRuleSetId && {
      simulationRuleSetId: args.simulationRuleSetId,
    }),
  });
  const patientDateOfBirth = await resolvePatientDateOfBirth(ctx, {
    ...(args.patientDateOfBirth && {
      patientDateOfBirth: args.patientDateOfBirth,
    }),
    ...(args.patientId && { patientId: args.patientId }),
  });

  for (const [index, step] of preview.steps.entries()) {
    const occupancyReferences = await resolveOccupancyReferenceLineageKeys(
      ctx.db,
      {
        locationId: asLocationId(step.locationId),
        ...(step.practitionerId && {
          practitionerId: asPractitionerId(step.practitionerId),
        }),
      },
    );
    const conflictingAppointment = await findConflictingAppointment(ctx.db, {
      candidate: {
        end: step.end,
        locationLineageKey: occupancyReferences.locationLineageKey,
        occupancyScope: step.occupancyScope,
        start: step.start,
      },
      ...(simulationRuleSetId && { draftRuleSetId: simulationRuleSetId }),
      occupancyView: getOccupancyViewForBookingScope(scope),
      practiceId: args.practiceId,
      ...(index === 0 &&
        args.rootReplacesAppointmentId && {
          excludeAppointmentIds: [args.rootReplacesAppointmentId],
        }),
    });

    if (conflictingAppointment) {
      throw appointmentSeriesError(
        "FOLLOW_UP_SLOT_UNAVAILABLE",
        `Der Termin fuer Schritt ${step.seriesStepIndex + 1} ist nicht mehr verfuegbar.`,
      );
    }

    const stepAppointmentType = await ctx.db.get(
      "appointmentTypes",
      step.appointmentTypeId,
    );
    if (!stepAppointmentType) {
      throw appointmentSeriesError(
        "CHAIN_REPLAN_FAILED",
        "Die Terminart fuer einen Kettentermin existiert nicht mehr.",
      );
    }

    const appointmentId = await ctx.db.insert("appointments", {
      appointmentTypeLineageKey: step.appointmentTypeLineageKey,
      appointmentTypeTitle: step.appointmentTypeTitle,
      ...(args.bookingIdentityId && {
        bookingIdentityId: args.bookingIdentityId,
      }),
      color:
        index === 0 && args.rootColor !== undefined
          ? args.rootColor
          : await resolveAppointmentColorForType(ctx.db, stepAppointmentType),
      createdAt: now,
      end: step.end,
      ...(scope === "simulation" && {
        isSimulation: true,
        simulationKind: "draft" as const,
        ...(simulationRuleSetId && { simulationRuleSetId }),
        simulationValidatedAt: now,
      }),
      lastModified: now,
      locationLineageKey: occupancyReferences.locationLineageKey,
      occupancyScope: step.occupancyScope,
      ...(args.patientId && { patientId: args.patientId }),
      practiceId: args.practiceId,
      ...(index === 0 &&
        args.rootReplacesAppointmentId && {
          replacesAppointmentId: args.rootReplacesAppointmentId,
        }),
      seriesId,
      seriesStepId: step.stepId,
      seriesStepIndex: toStoredSeriesStepIndex(step.seriesStepIndex),
      ...(index === 0 && args.rootSmiley !== undefined
        ? { smiley: args.rootSmiley }
        : {}),
      start: step.start,
      title:
        index === 0
          ? args.rootTitle
          : `Folgetermin: ${step.appointmentTypeTitle}`,
      ...(args.userId && { userId: args.userId }),
    });

    appointmentIds.push(appointmentId);
    createdSteps.push({
      ...step,
      appointmentId,
    });
  }

  const rootAppointmentId = appointmentIds[0];
  if (!rootAppointmentId) {
    throw appointmentSeriesError(
      "CHAIN_REPLAN_FAILED",
      "The appointment series did not create a root appointment.",
    );
  }

  await ctx.db.insert("appointmentSeries", {
    ...(args.bookingIdentityId && {
      bookingIdentityId: args.bookingIdentityId,
    }),
    appointmentPlanSnapshot:
      normalizeAppointmentPlanSnapshotFromType(rootAppointmentType),
    createdAt: now,
    lastModified: now,
    ...(patientDateOfBirth && { patientDateOfBirth }),
    ...(args.patientId && { patientId: args.patientId }),
    practiceId: args.practiceId,
    rootAppointmentId,
    rootAppointmentTypeId: rootAppointmentType._id,
    rootAppointmentTypeLineageKey: requireLineageKey({
      entityId: rootAppointmentType._id,
      entityType: "appointment type",
      lineageKey: rootAppointmentType.lineageKey,
      ruleSetId: rootAppointmentType.ruleSetId,
    }),
    rootDurationMinutes: rootAppointmentType.duration,
    ruleSetIdAtBooking: args.ruleSetId,
    scope,
    seriesId,
    ...(args.userId && { userId: args.userId }),
  });

  return {
    appointmentIds,
    rootAppointmentId,
    seriesId,
    steps: createdSteps,
  };
}

export async function planSeriesFromRootCandidate(
  ctx: SeriesPlannerCtx,
  args: {
    planningState: SeriesPlanningState;
    requestedAt: InstantString;
    rootCandidate: RootSeriesCandidate;
    seriesSpecification: SeriesSpecification;
  },
): Promise<SeriesPlanningResult> {
  const rootOccupancy = await resolveRootOccupancy(ctx, {
    appointmentType: args.seriesSpecification.rootAppointmentType,
    ...(args.rootCandidate.calendarResourceColumn && {
      calendarResourceColumn: args.rootCandidate.calendarResourceColumn,
    }),
    ...(args.rootCandidate.practitionerId && {
      practitionerId: args.rootCandidate.practitionerId,
    }),
    ruleSetId: args.seriesSpecification.ruleSetId,
  });
  const validatedRoot = await validateRootCandidate(ctx, {
    appointmentType: args.seriesSpecification.rootAppointmentType,
    ...(args.rootCandidate.excludedAppointmentIds && {
      excludedAppointmentIds: args.rootCandidate.excludedAppointmentIds,
    }),
    locationId: args.rootCandidate.locationId,
    ...(args.rootCandidate.patientDateOfBirth && {
      patientDateOfBirth: args.rootCandidate.patientDateOfBirth,
    }),
    planningState: args.planningState,
    practiceId: args.rootCandidate.practiceId,
    requestedAt: args.requestedAt,
    rootDurationMinutes: args.seriesSpecification.rootDurationMinutes,
    rootOccupancy,
    ruleSetId: args.seriesSpecification.ruleSetId,
    ...(args.rootCandidate.scope && { scope: args.rootCandidate.scope }),
    ...(args.rootCandidate.simulationRuleSetId && {
      simulationRuleSetId: args.rootCandidate.simulationRuleSetId,
    }),
    start: args.rootCandidate.start,
  });

  if (validatedRoot.status === "blocked") {
    return validatedRoot;
  }

  const rootStep: PlannedSeriesStep = {
    appointmentTypeId: args.seriesSpecification.rootAppointmentType._id,
    appointmentTypeLineageKey: asAppointmentTypeLineageKey(
      requireLineageKey({
        entityId: args.seriesSpecification.rootAppointmentType._id,
        entityType: "appointment type",
        lineageKey: args.seriesSpecification.rootAppointmentType.lineageKey,
        ruleSetId: args.seriesSpecification.rootAppointmentType.ruleSetId,
      }),
    ),
    appointmentTypeTitle: args.seriesSpecification.rootAppointmentType.name,
    durationMinutes: args.seriesSpecification.rootDurationMinutes,
    end: calculateEndTime(
      args.rootCandidate.start,
      args.seriesSpecification.rootDurationMinutes,
    ),
    locationId: args.rootCandidate.locationId,
    locationLineageKey: validatedRoot.locationLineageKey,
    occupancyScope: rootOccupancy.occupancyScope,
    ...(rootOccupancy.calendarResourceColumn && {
      calendarResourceColumn: rootOccupancy.calendarResourceColumn,
    }),
    ...(rootOccupancy.practitionerId && {
      practitionerId: rootOccupancy.practitionerId,
    }),
    ...(rootOccupancy.practitionerName && {
      practitionerName: rootOccupancy.practitionerName,
    }),
    seriesStepIndex: 0,
    start: args.rootCandidate.start,
    stepId: "root",
  };

  const plannedSteps: PlannedSeriesStep[] = [rootStep];
  let previousStep = rootStep;

  for (const step of args.seriesSpecification.appointmentPlanSnapshot) {
    const targetAppointmentType = await requireAppointmentTypeByLineageKey(
      ctx.db,
      args.seriesSpecification.ruleSetId,
      step.appointmentTypeLineageKey,
    );
    const plannedStep = await planAppointmentPlanStep(ctx, {
      ...(args.rootCandidate.isNewPatient !== undefined && {
        isNewPatient: args.rootCandidate.isNewPatient,
      }),
      ...(args.rootCandidate.patientDateOfBirth && {
        patientDateOfBirth: args.rootCandidate.patientDateOfBirth,
      }),
      locationId: args.rootCandidate.locationId,
      plannedSteps,
      planningState: args.planningState,
      practiceId: args.rootCandidate.practiceId,
      previousStep,
      requestedAt: args.requestedAt,
      rootStep,
      ruleSetId: args.seriesSpecification.ruleSetId,
      ...(args.rootCandidate.scope && { scope: args.rootCandidate.scope }),
      ...(args.rootCandidate.simulationRuleSetId && {
        simulationRuleSetId: args.rootCandidate.simulationRuleSetId,
      }),
      step,
      targetAppointmentType,
      ...(args.rootCandidate.excludedAppointmentIds && {
        excludedAppointmentIds: args.rootCandidate.excludedAppointmentIds,
      }),
    });

    if (!plannedStep) {
      if (step.required) {
        return {
          blockedStepId: step.stepId,
          failureMessage: `Kein verfügbarer Kettentermin für "${targetAppointmentType.name}" gefunden.`,
          status: "blocked",
          steps: plannedSteps,
        };
      }
      continue;
    }

    plannedSteps.push(plannedStep);
    previousStep = plannedStep;
  }

  return {
    status: "ready",
    steps: plannedSteps,
  };
}

export async function previewAppointmentSeries(
  ctx: SeriesPlannerCtx,
  args: {
    calendarResourceColumn?: CalendarResourceColumn;
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    rootAppointmentTypeId: Id<"appointmentTypes">;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: ZonedDateTimeString;
    userId?: Id<"users">;
  },
  planningState = createSeriesPlanningState(),
): Promise<SeriesPlanningResult> {
  const rootAppointmentType = await loadRootAppointmentType(ctx, args);
  const patientDateOfBirth = await resolvePatientDateOfBirth(ctx, {
    ...(args.patientDateOfBirth && {
      patientDateOfBirth: args.patientDateOfBirth,
    }),
    ...(args.patientId && { patientId: args.patientId }),
  });
  const requestedAt = asInstantString(Temporal.Now.instant().toString());
  const simulationRuleSetId = resolveSeriesSimulationRuleSetId(args);

  return await planSeriesFromRootCandidate(ctx, {
    planningState,
    requestedAt,
    rootCandidate: {
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      ...(args.isNewPatient !== undefined && {
        isNewPatient: args.isNewPatient,
      }),
      locationId: args.locationId,
      ...(patientDateOfBirth && { patientDateOfBirth }),
      ...(args.patientId && { patientId: args.patientId }),
      practiceId: args.practiceId,
      ...(args.calendarResourceColumn && {
        calendarResourceColumn: args.calendarResourceColumn,
      }),
      ...(args.practitionerId && { practitionerId: args.practitionerId }),
      ...(args.scope && { scope: args.scope }),
      ...(simulationRuleSetId && {
        simulationRuleSetId,
      }),
      start: args.start,
      ...(args.userId && { userId: args.userId }),
    },
    seriesSpecification: {
      appointmentPlanSnapshot:
        normalizeAppointmentPlanSnapshotFromType(rootAppointmentType),
      rootAppointmentType,
      rootDurationMinutes: rootAppointmentType.duration,
      ruleSetId: args.ruleSetId,
    },
  });
}

export async function replanAppointmentSeries(
  ctx: MutationCtx,
  args: {
    calendarResourceColumn?: CalendarResourceColumn;
    excludedAppointmentIds: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    rootDurationMinutes: number;
    scope: AppointmentBookingScope;
    series: Doc<"appointmentSeries">;
    start: ZonedDateTimeString;
    userId?: Id<"users">;
  },
): Promise<PlannedSeriesStep[]> {
  const rootAppointmentType = await loadRootAppointmentType(ctx, {
    practiceId: args.practiceId,
    rootAppointmentTypeId: args.series.rootAppointmentTypeId,
    ruleSetId: args.series.ruleSetIdAtBooking,
  });
  const requestedAt = asInstantString(Temporal.Now.instant().toString());
  const planningState = createSeriesPlanningState();
  const simulationRuleSetId = resolveSeriesSimulationRuleSetId({
    ruleSetId: args.series.ruleSetIdAtBooking,
    scope: args.scope,
  });
  const patientDateOfBirth = await resolvePatientDateOfBirth(ctx, {
    ...(args.patientDateOfBirth && {
      patientDateOfBirth: args.patientDateOfBirth,
    }),
    ...(args.patientId && { patientId: args.patientId }),
  });
  const result = await planSeriesFromRootCandidate(ctx, {
    planningState,
    requestedAt,
    rootCandidate: {
      excludedAppointmentIds: args.excludedAppointmentIds,
      ...(args.isNewPatient !== undefined && {
        isNewPatient: args.isNewPatient,
      }),
      locationId: args.locationId,
      ...(patientDateOfBirth && { patientDateOfBirth }),
      ...(args.patientId && { patientId: args.patientId }),
      practiceId: args.practiceId,
      ...(args.calendarResourceColumn && {
        calendarResourceColumn: args.calendarResourceColumn,
      }),
      ...(args.practitionerId && { practitionerId: args.practitionerId }),
      scope: args.scope,
      ...(simulationRuleSetId && { simulationRuleSetId }),
      start: args.start,
      ...(args.userId && { userId: args.userId }),
    },
    seriesSpecification: {
      appointmentPlanSnapshot: normalizeAppointmentPlanSnapshot({
        steps: args.series.appointmentPlanSnapshot,
      }),
      rootAppointmentType,
      rootDurationMinutes: args.rootDurationMinutes,
      ruleSetId: args.series.ruleSetIdAtBooking,
    },
  });

  if (result.status === "blocked") {
    throw appointmentSeriesError(
      "CHAIN_REPLAN_FAILED",
      result.failureMessage ||
        "Die Kettentermine konnten nicht vollständig neu geplant werden.",
    );
  }

  return result.steps;
}

export function toStoredSeriesStepIndex(seriesStepIndex: number): bigint {
  if (!Number.isInteger(seriesStepIndex) || seriesStepIndex < 0) {
    throw appointmentSeriesError(
      "CHAIN_REPLAN_FAILED",
      `[APPOINTMENT_SERIES:INVALID_STEP_INDEX] Ungueltiger seriesStepIndex ${seriesStepIndex}.`,
    );
  }

  return BigInt(seriesStepIndex);
}

function addDateOffset(
  start: Temporal.ZonedDateTime,
  timing: Extract<AppointmentPlanTiming, { kind: "afterPreviousEnd" }>,
) {
  switch (timing.offsetUnit) {
    case "days": {
      return start.add({ days: timing.offsetValue });
    }
    case "minutes": {
      return start.add({ minutes: timing.offsetValue });
    }
    case "months": {
      return start.add({ months: timing.offsetValue });
    }
    case "weeks": {
      return start.add({ weeks: timing.offsetValue });
    }
  }
}

function appointmentSeriesError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function buildPlannedStepCandidate(args: {
  locationId: Id<"locations">;
  locationLineageKey: LocationLineageKey;
  occupancy: ResolvedPlanOccupancy;
  plannedStepsCount: number;
  start: ZonedDateTimeString;
  step: AppointmentPlanStep;
  targetAppointmentType: Doc<"appointmentTypes">;
}): PlannedSeriesStep {
  return {
    appointmentTypeId: args.targetAppointmentType._id,
    appointmentTypeLineageKey: asAppointmentTypeLineageKey(
      requireLineageKey({
        entityId: args.targetAppointmentType._id,
        entityType: "appointment type",
        lineageKey: args.targetAppointmentType.lineageKey,
        ruleSetId: args.targetAppointmentType.ruleSetId,
      }),
    ),
    appointmentTypeTitle: args.targetAppointmentType.name,
    ...(args.occupancy.calendarResourceColumn && {
      calendarResourceColumn: args.occupancy.calendarResourceColumn,
    }),
    durationMinutes: args.targetAppointmentType.duration,
    end: calculateEndTime(args.start, args.targetAppointmentType.duration),
    locationId: args.locationId,
    locationLineageKey: args.locationLineageKey,
    ...(args.step.note ? { note: args.step.note } : {}),
    occupancyScope: args.occupancy.occupancyScope,
    ...(args.occupancy.practitionerId && {
      practitionerId: args.occupancy.practitionerId,
    }),
    ...(args.occupancy.practitionerName && {
      practitionerName: args.occupancy.practitionerName,
    }),
    seriesStepIndex: args.plannedStepsCount,
    start: args.start,
    stepId: args.step.stepId,
  };
}

function calculateEndTime(
  startTime: ZonedDateTimeString,
  durationMinutes: number,
): ZonedDateTimeString {
  return asZonedDateTimeString(
    Temporal.ZonedDateTime.from(startTime)
      .add({ minutes: durationMinutes })
      .toString(),
  );
}

function calculateExactStepStart(
  timing: AppointmentPlanTiming,
  args: {
    durationMinutes: number;
    plannedSteps: PlannedSeriesStep[];
    previousStep: PlannedSeriesStep;
    rootStep: PlannedSeriesStep;
  },
): null | ZonedDateTimeString {
  switch (timing.kind) {
    case "afterPreviousEnd": {
      if (timing.offsetUnit !== "minutes") {
        return null;
      }
      return asZonedDateTimeString(
        Temporal.ZonedDateTime.from(args.previousStep.end)
          .add({ minutes: timing.offsetValue })
          .toString(),
      );
    }
    case "beforeRootStart": {
      return asZonedDateTimeString(
        Temporal.ZonedDateTime.from(args.rootStep.start)
          .subtract({
            minutes: args.durationMinutes + timing.offsetMinutes,
          })
          .toString(),
      );
    }
    case "sameStartAs": {
      return findAnchorStep(args.plannedSteps, timing.anchorStepId).start;
    }
  }
}

function createSeriesId(): string {
  return `series_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createSeriesPlanningState(): SeriesPlanningState {
  return {
    baseSchedulesByRuleSet: new Map(),
    eligibleWeekdays: new Map(),
    slotCache: new Map(),
  };
}

function findAnchorStep(
  plannedSteps: PlannedSeriesStep[],
  anchorStepId: string,
): PlannedSeriesStep {
  const step = plannedSteps.find(
    (candidate) => candidate.stepId === anchorStepId,
  );
  if (!step) {
    throw appointmentSeriesError(
      "CHAIN_REPLAN_FAILED",
      `Kettentermin-Anker ${anchorStepId} wurde nicht gefunden.`,
    );
  }
  return step;
}

async function findFirstAvailableStepStart(
  ctx: SeriesPlannerCtx,
  args: {
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    occupancy: ResolvedPlanOccupancy;
    patientDateOfBirth?: IsoDateString;
    plannedSteps: PlannedSeriesStep[];
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    previousStep: PlannedSeriesStep;
    requestedAt: InstantString;
    rootStep: PlannedSeriesStep;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    targetAppointmentType: Doc<"appointmentTypes">;
    timing: AppointmentPlanTiming;
  },
): Promise<null | ZonedDateTimeString> {
  if (
    args.timing.kind !== "afterPreviousEnd" ||
    args.timing.offsetUnit === "minutes"
  ) {
    return null;
  }

  const earliestStart = addDateOffset(
    Temporal.ZonedDateTime.from(args.previousStep.end),
    args.timing,
  );

  if (!args.occupancy.practitionerId) {
    return asZonedDateTimeString(earliestStart.toString());
  }

  const searchDates = await getSearchDatesOnOrAfter(ctx, {
    earliestStart,
    locationId: args.locationId,
    planningState: args.planningState,
    practiceId: args.practiceId,
    practitionerId: args.occupancy.practitionerId,
    ruleSetId: args.ruleSetId,
  });

  for (const searchDate of searchDates) {
    const slots = await queryAvailableSlotsForDay(ctx, {
      appointmentType: args.targetAppointmentType,
      date: asIsoDateString(searchDate.toString()),
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      ...(args.isNewPatient !== undefined && {
        isNewPatient: args.isNewPatient,
      }),
      locationId: args.locationId,
      planningState: args.planningState,
      ...(args.patientDateOfBirth && {
        patientDateOfBirth: args.patientDateOfBirth,
      }),
      practiceId: args.practiceId,
      practitionerId: args.occupancy.practitionerId,
      requestedAt: args.requestedAt,
      ruleSetId: args.ruleSetId,
      ...(args.scope && { scope: args.scope }),
      ...(args.simulationRuleSetId && {
        simulationRuleSetId: args.simulationRuleSetId,
      }),
    });
    const matchingSlot = slots[0];
    if (matchingSlot) {
      return asZonedDateTimeString(matchingSlot.startTime);
    }
  }

  return null;
}

function getAppointmentPlanSearchWindow(
  earliestStart: Temporal.ZonedDateTime,
): {
  endDate: Temporal.PlainDate;
  startDate: Temporal.PlainDate;
} {
  const targetDate = earliestStart.toPlainDate();

  return {
    endDate: targetDate.add({ days: MAX_SERIES_SEARCH_DAYS }),
    startDate: targetDate,
  };
}

async function getEligibleWeekdays(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  args: {
    locationId?: Id<"locations">;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
  },
) {
  const cacheKey = [
    args.ruleSetId,
    args.practiceId,
    args.locationId ?? "",
    args.practitionerId ?? "",
  ].join("|");
  const cachedWeekdays = args.planningState.eligibleWeekdays.get(cacheKey);
  if (cachedWeekdays) {
    return cachedWeekdays;
  }

  let baseSchedulesPromise = args.planningState.baseSchedulesByRuleSet.get(
    args.ruleSetId,
  );
  if (!baseSchedulesPromise) {
    baseSchedulesPromise = ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
    args.planningState.baseSchedulesByRuleSet.set(
      args.ruleSetId,
      baseSchedulesPromise,
    );
  }

  const baseSchedules = await baseSchedulesPromise;
  const [locationLineageKey, practitionerLineageKey] = await Promise.all([
    args.locationId
      ? ctx.db.get("locations", args.locationId).then((location) => {
          if (!location) {
            throw new Error(`Standort ${args.locationId} nicht gefunden.`);
          }
          return asLocationLineageKey(
            requireLineageKey({
              entityId: location._id,
              entityType: "location",
              lineageKey: location.lineageKey,
              ruleSetId: location.ruleSetId,
            }),
          );
        })
      : Promise.resolve(),
    args.practitionerId
      ? ctx.db
          .get("practitioners", args.practitionerId)
          .then((practitioner) => {
            if (!practitioner) {
              throw new Error(
                `Behandler ${args.practitionerId} nicht gefunden.`,
              );
            }
            return asPractitionerLineageKey(
              requireLineageKey({
                entityId: practitioner._id,
                entityType: "practitioner",
                lineageKey: practitioner.lineageKey,
                ruleSetId: practitioner.ruleSetId,
              }),
            );
          })
      : Promise.resolve(),
  ]);
  const weekdays = [
    ...new Set(
      baseSchedules
        .filter((schedule) => schedule.practiceId === args.practiceId)
        .filter((schedule) =>
          locationLineageKey
            ? schedule.locationLineageKey === locationLineageKey
            : true,
        )
        .filter((schedule) =>
          practitionerLineageKey
            ? schedule.practitionerLineageKey === practitionerLineageKey
            : true,
        )
        .map((schedule) => schedule.dayOfWeek),
    ),
  ].toSorted((left, right) => left - right);

  args.planningState.eligibleWeekdays.set(cacheKey, weekdays);
  return weekdays;
}

async function getSearchDatesOnOrAfter(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  args: {
    earliestStart: Temporal.ZonedDateTime;
    locationId?: Id<"locations">;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
  },
) {
  const eligibleWeekdays = await getEligibleWeekdays(ctx, args);

  if (eligibleWeekdays.length === 0) {
    return [];
  }

  const { endDate, startDate } = getAppointmentPlanSearchWindow(
    args.earliestStart,
  );
  const totalDays = startDate.until(endDate).days;

  if (totalDays > MAX_SERIES_SEARCH_DAYS) {
    throw appointmentSeriesError(
      "CHAIN_REPLAN_FAILED",
      `[APPOINTMENT_SERIES:SEARCH_WINDOW_TOO_LARGE] Suchfenster überschreitet ${MAX_SERIES_SEARCH_DAYS} Tage.`,
    );
  }

  const searchDates: Temporal.PlainDate[] = [];

  for (let dayOffset = 0; dayOffset <= totalDays; dayOffset++) {
    const searchDate = startDate.add({ days: dayOffset });
    const scheduleDayOfWeek =
      searchDate.dayOfWeek === 7 ? 0 : searchDate.dayOfWeek;
    if (!eligibleWeekdays.includes(scheduleDayOfWeek)) {
      continue;
    }
    if (isPublicHoliday(searchDate)) {
      continue;
    }
    searchDates.push(searchDate);
  }

  return searchDates;
}

async function hasExactPractitionerSlot(
  ctx: SeriesPlannerCtx,
  args: {
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    requestedAt: InstantString;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: ZonedDateTimeString;
    targetAppointmentType: Doc<"appointmentTypes">;
  },
): Promise<boolean> {
  const slots = await queryAvailableSlotsForDay(ctx, {
    appointmentType: args.targetAppointmentType,
    date: asIsoDateString(
      Temporal.ZonedDateTime.from(args.start).toPlainDate().toString(),
    ),
    ...(args.excludedAppointmentIds && {
      excludedAppointmentIds: args.excludedAppointmentIds,
    }),
    ...(args.isNewPatient !== undefined && {
      isNewPatient: args.isNewPatient,
    }),
    locationId: args.locationId,
    planningState: args.planningState,
    ...(args.patientDateOfBirth && {
      patientDateOfBirth: args.patientDateOfBirth,
    }),
    practiceId: args.practiceId,
    practitionerId: args.practitionerId,
    requestedAt: args.requestedAt,
    ruleSetId: args.ruleSetId,
    ...(args.scope && { scope: args.scope }),
    ...(args.simulationRuleSetId && {
      simulationRuleSetId: args.simulationRuleSetId,
    }),
  });

  return slots.some((slot) => slot.startTime === args.start);
}

function hasPlannedStepConflict(
  plannedSteps: PlannedSeriesStep[],
  candidate: PlannedSeriesStep,
): boolean {
  return plannedSteps.some((plannedStep) =>
    appointmentOverlapsCandidate(
      {
        end: plannedStep.end,
        locationLineageKey: plannedStep.locationLineageKey,
        occupancyScope: plannedStep.occupancyScope,
        start: plannedStep.start,
      },
      {
        end: candidate.end,
        locationLineageKey: candidate.locationLineageKey,
        occupancyScope: candidate.occupancyScope,
        start: candidate.start,
      },
    ),
  );
}

async function loadRootAppointmentType(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  args: {
    practiceId: Id<"practices">;
    rootAppointmentTypeId: Id<"appointmentTypes">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<Doc<"appointmentTypes">> {
  const appointmentType = await ctx.db.get(
    "appointmentTypes",
    args.rootAppointmentTypeId,
  );

  if (!appointmentType) {
    throw appointmentSeriesError(
      "CHAIN_NOT_FOUND",
      "Appointment type not found",
    );
  }

  if (appointmentType.practiceId !== args.practiceId) {
    throw appointmentSeriesError(
      "CHAIN_NOT_FOUND",
      "Appointment type does not belong to this practice",
    );
  }

  if (appointmentType.ruleSetId !== args.ruleSetId) {
    throw appointmentSeriesError(
      "CHAIN_NOT_FOUND",
      "Appointment type does not belong to this rule set",
    );
  }

  return appointmentType;
}

function normalizeAppointmentPlanSnapshot(
  appointmentPlan:
    | Doc<"appointmentTypes">["appointmentPlan"]
    | undefined
    | { steps: AppointmentPlanStep[] },
): AppointmentPlanStep[] {
  return normalizeAppointmentPlan(appointmentPlan)?.steps ?? [];
}

function normalizeAppointmentPlanSnapshotFromType(
  appointmentType: Pick<Doc<"appointmentTypes">, "appointmentPlan">,
): AppointmentPlanStep[] {
  return normalizeAppointmentPlanSnapshot(appointmentType.appointmentPlan);
}

async function planAppointmentPlanStep(
  ctx: SeriesPlannerCtx,
  args: {
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    plannedSteps: PlannedSeriesStep[];
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    previousStep: PlannedSeriesStep;
    requestedAt: InstantString;
    rootStep: PlannedSeriesStep;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    step: AppointmentPlanStep;
    targetAppointmentType: Doc<"appointmentTypes">;
  },
): Promise<null | PlannedSeriesStep> {
  const occupancy = await resolveStepOccupancy(ctx, {
    occupancy: args.step.occupancy,
    rootStep: args.rootStep,
    targetAppointmentType: args.targetAppointmentType,
  });
  if (!occupancy) {
    return null;
  }

  const exactStart = calculateExactStepStart(args.step.timing, {
    durationMinutes: args.targetAppointmentType.duration,
    plannedSteps: args.plannedSteps,
    previousStep: args.previousStep,
    rootStep: args.rootStep,
  });

  const start =
    exactStart ??
    (await findFirstAvailableStepStart(ctx, {
      ...args,
      occupancy,
      timing: args.step.timing,
    }));

  if (!start) {
    return null;
  }

  if (
    exactStart &&
    occupancy.practitionerId &&
    !(await hasExactPractitionerSlot(ctx, {
      ...args,
      practitionerId: occupancy.practitionerId,
      start: exactStart,
    }))
  ) {
    return null;
  }

  const candidate = buildPlannedStepCandidate({
    locationId: args.locationId,
    locationLineageKey: args.rootStep.locationLineageKey,
    occupancy,
    plannedStepsCount: args.plannedSteps.length,
    start,
    step: args.step,
    targetAppointmentType: args.targetAppointmentType,
  });

  if (hasPlannedStepConflict(args.plannedSteps, candidate)) {
    return null;
  }

  const conflictingAppointment = await findConflictingAppointment(ctx.db, {
    candidate: {
      end: candidate.end,
      locationLineageKey: candidate.locationLineageKey,
      occupancyScope: candidate.occupancyScope,
      start: candidate.start,
    },
    ...(args.simulationRuleSetId && {
      draftRuleSetId: args.simulationRuleSetId,
    }),
    ...(args.excludedAppointmentIds && {
      excludeAppointmentIds: args.excludedAppointmentIds,
    }),
    occupancyView: getOccupancyViewForBookingScope(args.scope ?? "real"),
    practiceId: args.practiceId,
  });

  return conflictingAppointment ? null : candidate;
}

async function queryAvailableSlotsForDay(
  ctx: Pick<MutationCtx, "db" | "runQuery"> | Pick<QueryCtx, "db" | "runQuery">,
  args: {
    appointmentType: Doc<"appointmentTypes">;
    date: IsoDateString;
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId?: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    requestedAt: InstantString;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
  },
) {
  const cacheKey = [
    args.appointmentType._id,
    args.date,
    args.excludedAppointmentIds?.join(",") ?? "",
    args.isNewPatient === true ? "new" : "existing",
    args.locationId ?? "",
    args.patientDateOfBirth ?? "",
    args.practiceId,
    args.practitionerId ?? "",
    args.requestedAt,
    args.ruleSetId,
    args.scope ?? "real",
    args.simulationRuleSetId ?? "",
  ].join("|");
  const cachedSlots = args.planningState.slotCache.get(cacheKey);
  if (cachedSlots) {
    return cachedSlots;
  }
  const appointmentTypeLineageKey = args.appointmentType.lineageKey;
  if (!appointmentTypeLineageKey) {
    throw appointmentSeriesError(
      "CHAIN_NOT_FOUND",
      "Appointment type is missing its lineage key",
    );
  }

  const [
    allowedPractitionerLineageKeys,
    selectedLocationLineageKey,
    selectedPractitionerLineageKey,
  ] = await Promise.all([
    Promise.resolve(
      new Set(
        args.appointmentType.allowedPractitionerLineageKeys.map(
          (practitionerLineageKey) =>
            asPractitionerLineageKey(practitionerLineageKey),
        ),
      ),
    ),
    args.locationId === undefined
      ? Promise.resolve()
      : resolveLocationLineageKey(ctx.db, asLocationId(args.locationId)).then(
          (lineageKey) => asLocationLineageKey(lineageKey),
        ),
    args.practitionerId === undefined
      ? Promise.resolve()
      : resolvePractitionerLineageKey(
          ctx.db,
          asPractitionerId(args.practitionerId),
        ).then((lineageKey) => asPractitionerLineageKey(lineageKey)),
  ]);

  const result: { log: string[]; slots: InternalSchedulingResultSlot[] } =
    await ctx.runQuery(internal.scheduling.getSlotsForDayInternal, {
      date: args.date,
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      ...(args.scope && { scope: args.scope }),
      simulatedContext: {
        appointmentTypeLineageKey,
        clientType: "MFA",
        ...(selectedLocationLineageKey === undefined
          ? {}
          : { locationLineageKey: selectedLocationLineageKey }),
        patient: {
          ...(args.patientDateOfBirth && {
            dateOfBirth: args.patientDateOfBirth,
          }),
          isNew: args.isNewPatient ?? false,
        },
        requestedAt: args.requestedAt,
      },
    });

  const slots = result.slots
    .filter((slot) => slot.status === "AVAILABLE")
    .filter((slot) =>
      allowedPractitionerLineageKeys.has(slot.practitionerLineageKey),
    )
    .filter((slot) =>
      selectedPractitionerLineageKey
        ? slot.practitionerLineageKey === selectedPractitionerLineageKey
        : true,
    )
    .filter((slot) =>
      selectedLocationLineageKey
        ? slot.locationLineageKey === selectedLocationLineageKey
        : true,
    )
    .toSorted((left, right) => left.startTime.localeCompare(right.startTime));
  args.planningState.slotCache.set(cacheKey, slots);
  return slots;
}

function requireResolvedPractitionerOccupancy(
  occupancy: null | ResolvedPlanOccupancy,
): ResolvedPlanOccupancy {
  if (!occupancy) {
    throw appointmentSeriesError(
      "CHAIN_REPLAN_FAILED",
      "Der Behandler ist für diese Terminart nicht freigeschaltet.",
    );
  }

  return occupancy;
}

async function resolveDefaultOccupancy(
  ctx: SeriesPlannerCtx,
  args: {
    appointmentType: Doc<"appointmentTypes">;
    calendarResourceColumn?: CalendarResourceColumn;
    defaultOccupancy: AppointmentTypeDefaultOccupancy;
    practitionerId?: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<ResolvedPlanOccupancy> {
  switch (args.defaultOccupancy.kind) {
    case "resourceColumn": {
      const calendarResourceColumn =
        args.calendarResourceColumn ??
        args.defaultOccupancy.calendarResourceColumn;
      if (
        calendarResourceColumn !== args.defaultOccupancy.calendarResourceColumn
      ) {
        throw appointmentSeriesError(
          "CHAIN_REPLAN_FAILED",
          "Der Starttermin muss in der Standard-Ressourcenspalte der Terminart liegen.",
        );
      }
      return {
        calendarResourceColumn,
        occupancyScope: appointmentOccupancyScopeFromRefs({
          calendarResourceColumn,
        }),
      };
    }
    case "selectedPractitioner": {
      if (!args.practitionerId) {
        throw appointmentSeriesError(
          "CHAIN_REPLAN_FAILED",
          "Kettentermine benötigen einen ausgewählten Behandler für den Starttermin.",
        );
      }
      if (args.calendarResourceColumn) {
        throw appointmentSeriesError(
          "CHAIN_REPLAN_FAILED",
          "Kettentermine können nicht in EKG- oder Labor-Spalten verschoben werden.",
        );
      }
      return requireResolvedPractitionerOccupancy(
        await resolvePractitionerOccupancy(ctx, {
          appointmentType: args.appointmentType,
          practitionerId: args.practitionerId,
        }),
      );
    }
  }
}

async function resolvePatientDateOfBirth(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  args: {
    patientDateOfBirth?: IsoDateString;
    patientId?: Id<"patients">;
  },
): Promise<IsoDateString | undefined> {
  if (args.patientDateOfBirth) {
    return args.patientDateOfBirth;
  }

  if (!args.patientId) {
    return undefined;
  }

  const patient = await ctx.db.get("patients", args.patientId);
  return asOptionalIsoDateString(patient?.dateOfBirth);
}

async function resolvePractitionerOccupancy(
  ctx: SeriesPlannerCtx,
  args: {
    appointmentType: Doc<"appointmentTypes">;
    practitionerId: Id<"practitioners">;
  },
): Promise<null | ResolvedPlanOccupancy> {
  const practitioner = await ctx.db.get("practitioners", args.practitionerId);
  if (!practitioner) {
    return null;
  }
  const practitionerLineageKey = asPractitionerLineageKey(
    requireLineageKey({
      entityId: practitioner._id,
      entityType: "practitioner",
      lineageKey: practitioner.lineageKey,
      ruleSetId: practitioner.ruleSetId,
    }),
  );
  if (
    !args.appointmentType.allowedPractitionerLineageKeys.includes(
      practitionerLineageKey,
    )
  ) {
    return null;
  }

  return {
    occupancyScope: appointmentOccupancyScopeFromRefs({
      practitionerLineageKey,
    }),
    practitionerId: asPractitionerId(practitioner._id),
    practitionerName: practitioner.name,
  };
}

async function resolveRootOccupancy(
  ctx: SeriesPlannerCtx,
  args: {
    appointmentType: Doc<"appointmentTypes">;
    calendarResourceColumn?: CalendarResourceColumn;
    practitionerId?: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<ResolvedPlanOccupancy> {
  const defaultOccupancy = normalizeDefaultOccupancy(
    args.appointmentType.defaultOccupancy,
  );
  return await resolveDefaultOccupancy(ctx, {
    appointmentType: args.appointmentType,
    ...(args.calendarResourceColumn && {
      calendarResourceColumn: args.calendarResourceColumn,
    }),
    defaultOccupancy,
    ...(args.practitionerId && { practitionerId: args.practitionerId }),
    ruleSetId: args.ruleSetId,
  });
}

function resolveSeriesSimulationRuleSetId(args: {
  ruleSetId: Id<"ruleSets">;
  scope?: AppointmentBookingScope;
  simulationRuleSetId?: Id<"ruleSets">;
}) {
  if (args.scope !== "simulation") {
    return;
  }

  return args.simulationRuleSetId ?? args.ruleSetId;
}

async function resolveStepOccupancy(
  ctx: SeriesPlannerCtx,
  args: {
    occupancy: AppointmentPlanOccupancy;
    rootStep: PlannedSeriesStep;
    targetAppointmentType: Doc<"appointmentTypes">;
  },
): Promise<null | ResolvedPlanOccupancy> {
  switch (args.occupancy.kind) {
    case "inheritRootPractitioner": {
      if (!args.rootStep.practitionerId) {
        return null;
      }
      return await resolvePractitionerOccupancy(ctx, {
        appointmentType: args.targetAppointmentType,
        practitionerId: args.rootStep.practitionerId,
      });
    }
    case "resourceColumn": {
      return {
        calendarResourceColumn: args.occupancy.calendarResourceColumn,
        occupancyScope: appointmentOccupancyScopeFromRefs({
          calendarResourceColumn: args.occupancy.calendarResourceColumn,
        }),
      };
    }
  }
}

function validateDurationMinutes(durationMinutes: number): number {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw appointmentSeriesError(
      "CHAIN_REPLAN_FAILED",
      "Die Terminlänge muss eine positive ganze Zahl sein.",
    );
  }

  return durationMinutes;
}

async function validateRootCandidate(
  ctx: SeriesPlannerCtx,
  args: {
    appointmentType: Doc<"appointmentTypes">;
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    requestedAt: InstantString;
    rootDurationMinutes: number;
    rootOccupancy: ResolvedPlanOccupancy;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: ZonedDateTimeString;
  },
): Promise<
  | {
      blockedStepId: string;
      failureMessage: string;
      status: "blocked";
      steps: PlannedSeriesStep[];
    }
  | {
      locationLineageKey: LocationLineageKey;
      practitionerName?: string;
      status: "ready";
    }
> {
  validateDurationMinutes(args.rootDurationMinutes);

  const rootLocationLineageKey = await resolveLocationLineageKey(
    ctx.db,
    asLocationId(args.locationId),
  ).then((lineageKey) => asLocationLineageKey(lineageKey));

  if (args.rootOccupancy.practitionerId) {
    const rootPractitionerLineageKey = getAppointmentPractitionerLineageKey(
      args.rootOccupancy.occupancyScope,
    );
    if (!rootPractitionerLineageKey) {
      throw appointmentSeriesError(
        "CHAIN_REPLAN_FAILED",
        "Der Starttermin hat keine Behandler-Belegung.",
      );
    }

    const rootSlots = await queryAvailableSlotsForDay(ctx, {
      appointmentType: args.appointmentType,
      date: asIsoDateString(
        Temporal.ZonedDateTime.from(args.start).toPlainDate().toString(),
      ),
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      ...(args.isNewPatient !== undefined && {
        isNewPatient: args.isNewPatient,
      }),
      locationId: args.locationId,
      planningState: args.planningState,
      ...(args.patientDateOfBirth && {
        patientDateOfBirth: args.patientDateOfBirth,
      }),
      practiceId: args.practiceId,
      practitionerId: args.rootOccupancy.practitionerId,
      requestedAt: args.requestedAt,
      ruleSetId: args.ruleSetId,
      ...(args.scope && { scope: args.scope }),
      ...(args.simulationRuleSetId && {
        simulationRuleSetId: args.simulationRuleSetId,
      }),
    });

    const hasSelectedRootSlot = rootSlots.some(
      (slot) =>
        slot.startTime === args.start &&
        slot.locationLineageKey === rootLocationLineageKey &&
        slot.practitionerLineageKey === rootPractitionerLineageKey,
    );

    if (!hasSelectedRootSlot) {
      return {
        blockedStepId: "root",
        failureMessage:
          "Der ausgewählte Starttermin ist nicht mehr verfügbar oder wird durch Regeln blockiert.",
        status: "blocked",
        steps: [],
      };
    }
  }

  const conflictingAppointment = await findConflictingAppointment(ctx.db, {
    candidate: {
      end: calculateEndTime(args.start, args.rootDurationMinutes),
      locationLineageKey: rootLocationLineageKey,
      occupancyScope: args.rootOccupancy.occupancyScope,
      start: args.start,
    },
    ...(args.simulationRuleSetId && {
      draftRuleSetId: args.simulationRuleSetId,
    }),
    ...(args.excludedAppointmentIds && {
      excludeAppointmentIds: args.excludedAppointmentIds,
    }),
    occupancyView: getOccupancyViewForBookingScope(args.scope ?? "real"),
    practiceId: args.practiceId,
  });

  if (conflictingAppointment) {
    return {
      blockedStepId: "root",
      failureMessage:
        "Der ausgewählte Starttermin ist nicht mehr verfügbar oder wird durch Regeln blockiert.",
      status: "blocked",
      steps: [],
    };
  }

  return {
    locationLineageKey: rootLocationLineageKey,
    ...(args.rootOccupancy.practitionerName && {
      practitionerName: args.rootOccupancy.practitionerName,
    }),
    status: "ready",
  };
}
