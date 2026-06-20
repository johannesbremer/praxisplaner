import { ConvexError, v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { InstantString, IsoDateString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";
import type {
  DatabaseReader,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import type { InternalSchedulingResultSlot } from "./scheduling";
import type { AppointmentSmiley } from "./schema";
import type { ZonedDateTimeString } from "./typedDtos";

import { internal } from "./_generated/api";
import {
  type AppointmentBookingScope,
  appointmentOverlapsCandidate,
  findConflictingCalendarOccupancy,
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
  type AppointmentSeriesPlanningFailureKind,
  type BlockedSeriesPlanningResult,
  type PlannedSeriesStep,
  type SeriesPlanningResult,
} from "./appointmentSeriesPlanner";
import {
  asAppointmentTypeLineageKey,
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
  type LocationLineageKey,
} from "./identity";
import { requireLineageKey } from "./lineage";
import { isPublicHoliday } from "./publicHolidays";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import {
  asInstantString,
  asIsoDateString,
  asOptionalIsoDateString,
  asZonedDateTimeString,
} from "./typedDtos";

const MAX_SERIES_SEARCH_DAYS = 370;

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

export type SeriesRootOccupancy = ResolvedPlanOccupancy;

interface ResolvedPlanOccupancy {
  calendarResourceColumn?: CalendarResourceColumn;
  occupancyScope: AppointmentOccupancyScope;
  practitionerId?: Id<"practitioners">;
  practitionerName?: string;
}

interface RootSeriesCandidate {
  allowPlannerRuleOverride?: boolean;
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

interface SeriesPlanningState {
  baseSchedulesByRuleSet: Map<Id<"ruleSets">, Promise<Doc<"baseSchedules">[]>>;
  eligibleWeekdays: Map<string, number[]>;
  slotCache: Map<string, InternalSchedulingResultSlot[]>;
}

interface SeriesSpecification {
  appointmentPlanSnapshot: AppointmentPlanStep[];
  rootAppointmentType: Doc<"appointmentTypes">;
  rootDurationMinutes: number;
  rootOccupancy?: SeriesRootOccupancy;
  ruleSetId: Id<"ruleSets">;
}

type StepPlanningResult =
  | PlannedSeriesStep
  | {
      blockedStepEnd?: ZonedDateTimeString;
      blockedStepStart?: ZonedDateTimeString;
      blockingBlockedSlotId?: Id<"blockedSlots">;
      blockingRuleIds?: Id<"ruleConditions">[];
      failureKind: AppointmentSeriesPlanningFailureKind;
      failureMessage: string;
      status: "blocked";
    };

export async function createAppointmentSeries(
  ctx: MutationCtx,
  args: {
    allowPlannerRuleOverride?: boolean;
    bookingIdentityId?: Id<"bookingIdentities">;
    calendarResourceColumn?: CalendarResourceColumn;
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    rootAppointmentTypeId: Id<"appointmentTypes">;
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
  const scope = args.scope ?? "real";
  if (args.rootReplacesAppointmentId && scope !== "simulation") {
    throw appointmentSeriesError(
      "CHAIN_REPLAN_FAILED",
      "Only simulated appointment series can replace existing appointments.",
    );
  }

  const rootAppointmentType = await loadRootAppointmentType(ctx, {
    practiceId: args.practiceId,
    rootAppointmentTypeId: args.rootAppointmentTypeId,
    ruleSetId: args.ruleSetId,
  });
  const replacementExcludedAppointmentIds =
    await resolveReplacementExcludedAppointmentIds(
      ctx.db,
      args.rootReplacesAppointmentId,
    );
  const planningState = createSeriesPlanningState();
  const preview = await previewAppointmentSeries(
    ctx,
    {
      ...(args.allowPlannerRuleOverride === undefined
        ? {}
        : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
      ...(replacementExcludedAppointmentIds && {
        excludedAppointmentIds: replacementExcludedAppointmentIds,
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
    const conflictingOccupancy = await findConflictingCalendarOccupancy(
      ctx.db,
      {
        candidate: {
          end: step.end,
          locationLineageKey: occupancyReferences.locationLineageKey,
          occupancyScope: step.occupancyScope,
          start: step.start,
        },
        ...(simulationRuleSetId && { draftRuleSetId: simulationRuleSetId }),
        occupancyView: getOccupancyViewForBookingScope(scope),
        practiceId: args.practiceId,
        ...(replacementExcludedAppointmentIds && {
          excludeAppointmentIds: replacementExcludedAppointmentIds,
        }),
      },
    );

    if (conflictingOccupancy) {
      throw appointmentSeriesError(
        "FOLLOW_UP_SLOT_UNAVAILABLE",
        `Der Termin fuer Schritt ${step.seriesStepIndex + 1} ist nicht mehr verfuegbar.`,
      );
    }

    const appointmentId = await ctx.db.insert("appointments", {
      appointmentTypeLineageKey: step.appointmentTypeLineageKey,
      appointmentTypeTitle: step.appointmentTypeTitle,
      ...(args.bookingIdentityId && {
        bookingIdentityId: args.bookingIdentityId,
      }),
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

export function createSeriesPlanningState(): SeriesPlanningState {
  return {
    baseSchedulesByRuleSet: new Map(),
    eligibleWeekdays: new Map(),
    slotCache: new Map(),
  };
}

export async function hasResourceRootSchedulerAvailability(
  ctx: SeriesPlannerCtx,
  args: {
    allowPlannerRuleOverride?: boolean;
    appointmentType: Doc<"appointmentTypes">;
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    requestedAt: InstantString;
    rootDurationMinutes: number;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: ZonedDateTimeString;
  },
): Promise<boolean> {
  const rootSlots = await queryAvailableSlotsForDay(ctx, {
    ...(args.allowPlannerRuleOverride === undefined
      ? {}
      : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
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
    requestedAt: args.requestedAt,
    ruleSetId: args.ruleSetId,
    ...(args.scope && { scope: args.scope }),
    ...(args.simulationRuleSetId && {
      simulationRuleSetId: args.simulationRuleSetId,
    }),
  });

  return hasAnyConsecutiveAvailablePractitionerSlots(rootSlots, {
    durationMinutes: args.rootDurationMinutes,
    start: args.start,
  });
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
  const rootOccupancy =
    args.seriesSpecification.rootOccupancy ??
    (await resolveRootOccupancy(ctx, {
      appointmentType: args.seriesSpecification.rootAppointmentType,
      ...(args.rootCandidate.calendarResourceColumn && {
        calendarResourceColumn: args.rootCandidate.calendarResourceColumn,
      }),
      ...(args.rootCandidate.practitionerId && {
        practitionerId: args.rootCandidate.practitionerId,
      }),
      ruleSetId: args.seriesSpecification.ruleSetId,
    }));
  const validatedRoot = await validateRootCandidate(ctx, {
    ...(args.rootCandidate.allowPlannerRuleOverride === undefined
      ? {}
      : {
          allowPlannerRuleOverride: args.rootCandidate.allowPlannerRuleOverride,
        }),
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
    const plannedStepResult = await planAppointmentPlanStep(ctx, {
      ...(args.rootCandidate.allowPlannerRuleOverride === undefined
        ? {}
        : {
            allowPlannerRuleOverride:
              args.rootCandidate.allowPlannerRuleOverride,
          }),
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

    if (plannedStepResult && "status" in plannedStepResult) {
      if (step.required) {
        return blockedSeriesPlanningResult({
          blockedStepId: step.stepId,
          ...(plannedStepResult.blockedStepEnd === undefined
            ? {}
            : { blockedStepEnd: plannedStepResult.blockedStepEnd }),
          ...(plannedStepResult.blockedStepStart === undefined
            ? {}
            : { blockedStepStart: plannedStepResult.blockedStepStart }),
          ...(plannedStepResult.blockingBlockedSlotId === undefined
            ? {}
            : {
                blockingBlockedSlotId: plannedStepResult.blockingBlockedSlotId,
              }),
          ...(plannedStepResult.blockingRuleIds === undefined
            ? {}
            : { blockingRuleIds: plannedStepResult.blockingRuleIds }),
          failureKind: plannedStepResult.failureKind,
          failureMessage: plannedStepResult.failureMessage,
          steps: plannedSteps,
        });
      }
      continue;
    }

    if (!plannedStepResult) {
      if (step.required) {
        return blockedSeriesPlanningResult({
          blockedStepId: step.stepId,
          failureKind: "seriesStepUnavailable",
          failureMessage: `Kein verfügbarer Kettentermin für "${targetAppointmentType.name}" gefunden.`,
          steps: plannedSteps,
        });
      }
      continue;
    }

    plannedSteps.push(plannedStepResult);
    previousStep = plannedStepResult;
  }

  return {
    status: "ready",
    steps: plannedSteps,
  };
}

export async function previewAppointmentSeries(
  ctx: SeriesPlannerCtx,
  args: {
    allowPlannerRuleOverride?: boolean;
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
      ...(args.allowPlannerRuleOverride === undefined
        ? {}
        : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
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
    rootOccupancy: SeriesRootOccupancy;
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
      rootOccupancy: args.rootOccupancy,
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

function blockedSeriesPlanningResult(args: {
  blockedStepEnd?: ZonedDateTimeString;
  blockedStepId: string;
  blockedStepStart?: ZonedDateTimeString;
  blockingBlockedSlotId?: Id<"blockedSlots">;
  blockingRuleIds?: Id<"ruleConditions">[];
  failureKind: AppointmentSeriesPlanningFailureKind;
  failureMessage: string;
  steps: PlannedSeriesStep[];
}): BlockedSeriesPlanningResult {
  return {
    ...(args.blockedStepEnd === undefined
      ? {}
      : { blockedStepEnd: args.blockedStepEnd }),
    blockedStepId: args.blockedStepId,
    ...(args.blockedStepStart === undefined
      ? {}
      : { blockedStepStart: args.blockedStepStart }),
    ...(args.blockingBlockedSlotId === undefined
      ? {}
      : { blockingBlockedSlotId: args.blockingBlockedSlotId }),
    ...(args.blockingRuleIds === undefined || args.blockingRuleIds.length === 0
      ? {}
      : { blockingRuleIds: args.blockingRuleIds }),
    failureKind: args.failureKind,
    failureMessage: args.failureMessage,
    status: "blocked",
    steps: args.steps,
  };
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

async function buildPlannedStepIfAvailable(
  ctx: SeriesPlannerCtx,
  args: {
    allowPlannerRuleOverride?: boolean;
    excludedAppointmentIds?: Id<"appointments">[];
    locationId: Id<"locations">;
    occupancy: ResolvedPlanOccupancy;
    plannedSteps: PlannedSeriesStep[];
    practiceId: Id<"practices">;
    rootStep: PlannedSeriesStep;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: ZonedDateTimeString;
    step: AppointmentPlanStep;
    targetAppointmentType: Doc<"appointmentTypes">;
  },
): Promise<null | StepPlanningResult> {
  const candidate = buildPlannedStepCandidate({
    locationId: args.locationId,
    locationLineageKey: args.rootStep.locationLineageKey,
    occupancy: args.occupancy,
    plannedStepsCount: args.plannedSteps.length,
    start: args.start,
    step: args.step,
    targetAppointmentType: args.targetAppointmentType,
  });

  if (hasPlannedStepConflict(args.plannedSteps, candidate)) {
    return {
      blockedStepEnd: candidate.end,
      blockedStepStart: candidate.start,
      failureKind: "seriesInternalConflict",
      failureMessage:
        "Der Kettentermin überschneidet sich mit einem anderen Schritt.",
      status: "blocked",
    };
  }

  const conflictingOccupancy = await findConflictingCalendarOccupancy(ctx.db, {
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

  return conflictingOccupancy
    ? {
        blockedStepEnd: candidate.end,
        blockedStepStart: candidate.start,
        failureKind: "appointmentOccupancy",
        failureMessage:
          "Der Kettentermin ist bereits durch einen Termin belegt.",
        status: "blocked",
      }
    : candidate;
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
    step: AppointmentPlanStep;
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

  return await findFirstAvailableStepStartOnOrAfter(ctx, {
    ...args,
    earliestStart,
    respectEarliestStartTime: false,
  });
}

async function findFirstAvailableStepStartOnOrAfter(
  ctx: SeriesPlannerCtx,
  args: {
    allowPlannerRuleOverride?: boolean;
    earliestStart: Temporal.ZonedDateTime;
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    occupancy: ResolvedPlanOccupancy;
    patientDateOfBirth?: IsoDateString;
    plannedSteps: PlannedSeriesStep[];
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    requestedAt: InstantString;
    respectEarliestStartTime: boolean;
    rootStep: PlannedSeriesStep;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    step: AppointmentPlanStep;
    targetAppointmentType: Doc<"appointmentTypes">;
  },
): Promise<null | ZonedDateTimeString> {
  if (!args.occupancy.practitionerId) {
    if (!args.occupancy.calendarResourceColumn) {
      return null;
    }

    const searchDates = await getSearchDatesOnOrAfter(ctx, {
      earliestStart: args.earliestStart,
      locationId: args.locationId,
      planningState: args.planningState,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
    });

    for (const searchDate of searchDates) {
      const slots = await queryAvailableSlotsForDay(ctx, {
        ...(args.allowPlannerRuleOverride === undefined
          ? {}
          : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
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
        requestedAt: args.requestedAt,
        ruleSetId: args.ruleSetId,
        ...(args.scope && { scope: args.scope }),
        ...(args.simulationRuleSetId && {
          simulationRuleSetId: args.simulationRuleSetId,
        }),
      });
      const matchingSlots = slots.filter((slot) => {
        if (
          args.respectEarliestStartTime &&
          Temporal.ZonedDateTime.compare(
            Temporal.ZonedDateTime.from(slot.startTime),
            args.earliestStart,
          ) < 0
        ) {
          return false;
        }
        const practitionerSlots = slots.filter(
          (candidate) =>
            candidate.practitionerLineageKey === slot.practitionerLineageKey,
        );
        return hasConsecutiveAvailablePractitionerSlots(practitionerSlots, {
          durationMinutes: args.targetAppointmentType.duration,
          start: asZonedDateTimeString(slot.startTime),
        });
      });
      for (const slot of matchingSlots) {
        const start = asZonedDateTimeString(slot.startTime);
        const plannedStep = await buildPlannedStepIfAvailable(ctx, {
          ...(args.excludedAppointmentIds && {
            excludedAppointmentIds: args.excludedAppointmentIds,
          }),
          locationId: args.locationId,
          occupancy: args.occupancy,
          plannedSteps: args.plannedSteps,
          practiceId: args.practiceId,
          rootStep: args.rootStep,
          ...(args.scope && { scope: args.scope }),
          ...(args.simulationRuleSetId && {
            simulationRuleSetId: args.simulationRuleSetId,
          }),
          start,
          step: args.step,
          targetAppointmentType: args.targetAppointmentType,
        });
        if (plannedStep !== null && !("status" in plannedStep)) {
          return start;
        }
      }
    }

    return null;
  }

  const searchDates = await getSearchDatesOnOrAfter(ctx, {
    earliestStart: args.earliestStart,
    locationId: args.locationId,
    planningState: args.planningState,
    practiceId: args.practiceId,
    practitionerId: args.occupancy.practitionerId,
    ruleSetId: args.ruleSetId,
  });

  for (const searchDate of searchDates) {
    const slots = await queryAvailableSlotsForDay(ctx, {
      ...(args.allowPlannerRuleOverride === undefined
        ? {}
        : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
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
    const matchingSlot = slots.find((slot) => {
      if (
        args.respectEarliestStartTime &&
        Temporal.ZonedDateTime.compare(
          Temporal.ZonedDateTime.from(slot.startTime),
          args.earliestStart,
        ) < 0
      ) {
        return false;
      }
      return hasConsecutiveAvailablePractitionerSlots(slots, {
        durationMinutes: args.targetAppointmentType.duration,
        start: asZonedDateTimeString(slot.startTime),
      });
    });
    if (matchingSlot) {
      return asZonedDateTimeString(matchingSlot.startTime);
    }
  }

  return null;
}

function findFirstUnavailableSchedulerSlotInRange(
  slots: InternalSchedulingResultSlot[],
  args: {
    allowPlannerRuleOverride?: boolean;
    durationMinutes: number;
    start: ZonedDateTimeString;
  },
): InternalSchedulingResultSlot | undefined {
  const rangeEnd = Temporal.ZonedDateTime.from(args.start).add({
    minutes: args.durationMinutes,
  });
  let cursor = Temporal.ZonedDateTime.from(args.start);

  while (Temporal.ZonedDateTime.compare(cursor, rangeEnd) < 0) {
    const slot = slots.find(
      (candidate) => candidate.startTime === cursor.toString(),
    );
    if (!slot) {
      return undefined;
    }
    if (
      slot.status !== "AVAILABLE" &&
      !(
        args.allowPlannerRuleOverride === true &&
        slot.blockedByRuleId !== undefined
      )
    ) {
      return slot;
    }
    cursor = cursor.add({ minutes: slot.duration });
  }

  return undefined;
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

async function getExactPractitionerSlotAvailability(
  ctx: SeriesPlannerCtx,
  args: {
    allowPlannerRuleOverride?: boolean;
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
): Promise<
  | {
      available: false;
      failure: ReturnType<typeof schedulerFailureForSlot>;
    }
  | { available: true }
> {
  const schedulerSlots = await querySchedulingSlotsForDay(ctx, {
    ...(args.allowPlannerRuleOverride === undefined
      ? {}
      : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
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

  const slots = schedulerSlots.filter(
    (slot) =>
      slot.status === "AVAILABLE" ||
      (args.allowPlannerRuleOverride === true &&
        slot.blockedByRuleId !== undefined),
  );

  return hasConsecutiveAvailablePractitionerSlots(slots, {
    durationMinutes: args.targetAppointmentType.duration,
    start: args.start,
  })
    ? { available: true }
    : {
        available: false,
        failure: schedulerFailureForSlot(
          findFirstUnavailableSchedulerSlotInRange(schedulerSlots, {
            ...(args.allowPlannerRuleOverride === undefined
              ? {}
              : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
            durationMinutes: args.targetAppointmentType.duration,
            start: args.start,
          }),
        ),
      };
}

async function getExactResourceSlotAvailability(
  ctx: SeriesPlannerCtx,
  args: {
    allowPlannerRuleOverride?: boolean;
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    requestedAt: InstantString;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: ZonedDateTimeString;
    targetAppointmentType: Doc<"appointmentTypes">;
  },
): Promise<
  | {
      available: false;
      failure: ReturnType<typeof schedulerFailureForSlot>;
    }
  | { available: true }
> {
  const schedulerSlots = await querySchedulingSlotsForDay(ctx, {
    ...(args.allowPlannerRuleOverride === undefined
      ? {}
      : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
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
    requestedAt: args.requestedAt,
    ruleSetId: args.ruleSetId,
    ...(args.scope && { scope: args.scope }),
    ...(args.simulationRuleSetId && {
      simulationRuleSetId: args.simulationRuleSetId,
    }),
  });

  const slots = schedulerSlots.filter(
    (slot) =>
      slot.status === "AVAILABLE" ||
      (args.allowPlannerRuleOverride === true &&
        slot.blockedByRuleId !== undefined),
  );

  return hasAnyConsecutiveAvailablePractitionerSlots(slots, {
    durationMinutes: args.targetAppointmentType.duration,
    start: args.start,
  })
    ? { available: true }
    : {
        available: false,
        failure: schedulerFailureForSlot(
          findFirstUnavailableSchedulerSlotInRange(schedulerSlots, {
            ...(args.allowPlannerRuleOverride === undefined
              ? {}
              : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
            durationMinutes: args.targetAppointmentType.duration,
            start: args.start,
          }),
        ),
      };
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

function hasAnyConsecutiveAvailablePractitionerSlots(
  slots: InternalSchedulingResultSlot[],
  args: { durationMinutes: number; start: ZonedDateTimeString },
): boolean {
  const practitionerLineageKeys = new Set(
    slots
      .filter((slot) => slot.startTime === args.start)
      .map((slot) => slot.practitionerLineageKey),
  );

  for (const practitionerLineageKey of practitionerLineageKeys) {
    const practitionerSlots = slots.filter(
      (slot) => slot.practitionerLineageKey === practitionerLineageKey,
    );
    if (
      hasConsecutiveAvailablePractitionerSlots(practitionerSlots, {
        durationMinutes: args.durationMinutes,
        start: args.start,
      })
    ) {
      return true;
    }
  }

  return false;
}

function hasConsecutiveAvailablePractitionerSlots(
  slots: InternalSchedulingResultSlot[],
  args: { durationMinutes: number; start: ZonedDateTimeString },
): boolean {
  const slotsByStartTime = new Map(slots.map((slot) => [slot.startTime, slot]));
  const requestedStart = Temporal.ZonedDateTime.from(args.start);
  const requestedEnd = requestedStart.add({
    minutes: args.durationMinutes,
  });
  let cursor = requestedStart;

  while (Temporal.ZonedDateTime.compare(cursor, requestedEnd) < 0) {
    const slot = slotsByStartTime.get(asZonedDateTimeString(cursor.toString()));
    if (!slot || slot.duration <= 0) {
      return false;
    }

    cursor = cursor.add({ minutes: slot.duration });
  }

  return true;
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

  if (isRuleSetEntityDeleted(appointmentType)) {
    throw appointmentSeriesError(
      "CHAIN_NOT_FOUND",
      "Terminart wurde gelöscht und kann nicht mehr neu referenziert werden.",
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
    allowPlannerRuleOverride?: boolean;
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
): Promise<null | StepPlanningResult> {
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

  if (exactStart && occupancy.practitionerId) {
    const exactSlotAvailability = await getExactPractitionerSlotAvailability(
      ctx,
      {
        ...args,
        practitionerId: occupancy.practitionerId,
        start: exactStart,
      },
    );
    if (!exactSlotAvailability.available) {
      return {
        blockedStepEnd: calculateEndTime(
          exactStart,
          args.targetAppointmentType.duration,
        ),
        blockedStepStart: exactStart,
        ...exactSlotAvailability.failure,
        status: "blocked",
      };
    }
  }
  if (exactStart && occupancy.calendarResourceColumn) {
    const exactSlotAvailability = await getExactResourceSlotAvailability(ctx, {
      ...args,
      start: exactStart,
    });
    if (!exactSlotAvailability.available) {
      return {
        blockedStepEnd: calculateEndTime(
          exactStart,
          args.targetAppointmentType.duration,
        ),
        blockedStepStart: exactStart,
        ...exactSlotAvailability.failure,
        status: "blocked",
      };
    }
  }

  return await buildPlannedStepIfAvailable(ctx, {
    ...args,
    occupancy,
    start,
  });
}

async function queryAvailableSlotsForDay(
  ctx: Pick<MutationCtx, "db" | "runQuery"> | Pick<QueryCtx, "db" | "runQuery">,
  args: {
    allowPlannerRuleOverride?: boolean;
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
  const slots = await querySchedulingSlotsForDay(ctx, args);
  return slots.filter(
    (slot) =>
      slot.status === "AVAILABLE" ||
      (args.allowPlannerRuleOverride === true &&
        slot.blockedByRuleId !== undefined),
  );
}

async function querySchedulingSlotsForDay(
  ctx: Pick<MutationCtx, "db" | "runQuery"> | Pick<QueryCtx, "db" | "runQuery">,
  args: {
    allowPlannerRuleOverride?: boolean;
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
    "all-scheduler-slots",
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

async function resolveReplacementExcludedAppointmentIds(
  db: DatabaseReader,
  rootReplacesAppointmentId: Id<"appointments"> | undefined,
): Promise<Id<"appointments">[] | undefined> {
  if (rootReplacesAppointmentId === undefined) {
    return undefined;
  }

  const replacedAppointment = await db.get(
    "appointments",
    rootReplacesAppointmentId,
  );
  if (replacedAppointment?.seriesId === undefined) {
    return [rootReplacesAppointmentId];
  }

  const replacedSeriesAppointments = await db
    .query("appointments")
    .withIndex("by_seriesId", (q) =>
      q.eq("seriesId", replacedAppointment.seriesId),
    )
    .collect();

  return replacedSeriesAppointments.map((appointment) => appointment._id);
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

function schedulerFailureForSlot(
  slot: InternalSchedulingResultSlot | undefined,
): {
  blockingBlockedSlotId?: Id<"blockedSlots">;
  blockingRuleIds?: Id<"ruleConditions">[];
  failureKind: AppointmentSeriesPlanningFailureKind;
  failureMessage: string;
} {
  if (slot?.blockedByBlockedSlotId !== undefined) {
    return {
      blockingBlockedSlotId: slot.blockedByBlockedSlotId,
      failureKind: "blockedSlot",
      failureMessage:
        slot.reason ?? "Der ausgewählte Starttermin ist blockiert.",
    };
  }

  if (slot?.blockedByRuleId !== undefined) {
    return {
      blockingRuleIds: [slot.blockedByRuleId],
      failureKind: "ruleBlock",
      failureMessage:
        slot.reason ??
        "Der ausgewählte Starttermin wird durch eine Regel blockiert.",
    };
  }

  return {
    failureKind: "schedulerUnavailable",
    failureMessage:
      "Der ausgewählte Starttermin ist nicht mehr verfügbar oder liegt außerhalb der Verfügbarkeit.",
  };
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
    allowPlannerRuleOverride?: boolean;
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
  | BlockedSeriesPlanningResult
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

    const rootSchedulerSlots = await querySchedulingSlotsForDay(ctx, {
      ...(args.allowPlannerRuleOverride === undefined
        ? {}
        : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
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
    const rootSlots = rootSchedulerSlots.filter(
      (slot) =>
        slot.status === "AVAILABLE" ||
        (args.allowPlannerRuleOverride === true &&
          slot.blockedByRuleId !== undefined),
    );

    const hasSelectedRootSlot = rootSlots.some(
      (slot) =>
        slot.startTime === args.start &&
        slot.locationLineageKey === rootLocationLineageKey &&
        slot.practitionerLineageKey === rootPractitionerLineageKey &&
        hasConsecutiveAvailablePractitionerSlots(rootSlots, {
          durationMinutes: args.rootDurationMinutes,
          start: args.start,
        }),
    );

    if (!hasSelectedRootSlot) {
      const matchingBlockedSlot = rootSchedulerSlots.find(
        (slot) =>
          slot.startTime === args.start &&
          slot.locationLineageKey === rootLocationLineageKey &&
          slot.practitionerLineageKey === rootPractitionerLineageKey,
      );
      return blockedSeriesPlanningResult({
        blockedStepId: "root",
        ...schedulerFailureForSlot(matchingBlockedSlot),
        steps: [],
      });
    }
  } else if (args.rootOccupancy.calendarResourceColumn) {
    const hasSelectedResourceRootSlot =
      await hasResourceRootSchedulerAvailability(ctx, {
        ...(args.allowPlannerRuleOverride === undefined
          ? {}
          : { allowPlannerRuleOverride: args.allowPlannerRuleOverride }),
        appointmentType: args.appointmentType,
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
        requestedAt: args.requestedAt,
        rootDurationMinutes: args.rootDurationMinutes,
        ruleSetId: args.ruleSetId,
        ...(args.scope && { scope: args.scope }),
        ...(args.simulationRuleSetId && {
          simulationRuleSetId: args.simulationRuleSetId,
        }),
        start: args.start,
      });

    if (!hasSelectedResourceRootSlot) {
      const rootSchedulerSlots = await querySchedulingSlotsForDay(ctx, {
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
        requestedAt: args.requestedAt,
        ruleSetId: args.ruleSetId,
        ...(args.scope && { scope: args.scope }),
        ...(args.simulationRuleSetId && {
          simulationRuleSetId: args.simulationRuleSetId,
        }),
      });
      const matchingBlockedSlot = rootSchedulerSlots.find(
        (slot) =>
          slot.startTime === args.start &&
          slot.locationLineageKey === rootLocationLineageKey,
      );
      return blockedSeriesPlanningResult({
        blockedStepId: "root",
        ...schedulerFailureForSlot(matchingBlockedSlot),
        steps: [],
      });
    }
  }

  const conflictingOccupancy = await findConflictingCalendarOccupancy(ctx.db, {
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

  if (conflictingOccupancy) {
    return blockedSeriesPlanningResult({
      blockedStepId: "root",
      failureKind: "appointmentOccupancy",
      failureMessage:
        "Der ausgewählte Starttermin ist bereits durch einen Termin belegt.",
      steps: [],
    });
  }

  return {
    locationLineageKey: rootLocationLineageKey,
    ...(args.rootOccupancy.practitionerName && {
      practitionerName: args.rootOccupancy.practitionerName,
    }),
    status: "ready",
  };
}
