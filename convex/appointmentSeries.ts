import { ConvexError, v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { SchedulingResultSlot } from "./scheduling";

import { internal } from "./_generated/api";
import {
  type AppointmentBookingScope,
  findConflictingAppointment,
} from "./appointmentConflicts";
import { resolveStoredAppointmentReferencesForWrite } from "./appointmentReferences";
import {
  type FollowUpStep,
  requireAppointmentTypeByLineageKey,
} from "./followUpPlans";
import { isPublicHoliday } from "./publicHolidays";

const APPOINTMENT_TIMEZONE = "Europe/Berlin";
const MAX_SERIES_SEARCH_DAYS = 370;

export const appointmentSeriesPreviewStepValidator = v.object({
  appointmentTypeId: v.id("appointmentTypes"),
  appointmentTypeLineageKey: v.id("appointmentTypes"),
  appointmentTypeTitle: v.string(),
  durationMinutes: v.number(),
  end: v.string(),
  locationId: v.id("locations"),
  note: v.optional(v.string()),
  practitionerId: v.id("practitioners"),
  practitionerName: v.string(),
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
  durationMinutes: v.number(),
  end: v.string(),
  locationId: v.id("locations"),
  note: v.optional(v.string()),
  practitionerId: v.id("practitioners"),
  practitionerName: v.string(),
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
  isNewPatient: v.optional(v.boolean()),
  locationId: v.id("locations"),
  patientDateOfBirth: v.optional(v.string()),
  patientId: v.optional(v.id("patients")),
  practiceId: v.id("practices"),
  practitionerId: v.id("practitioners"),
  rootAppointmentTypeId: v.id("appointmentTypes"),
  ruleSetId: v.id("ruleSets"),
  scope: v.optional(v.union(v.literal("real"), v.literal("simulation"))),
  simulationRuleSetId: v.optional(v.id("ruleSets")),
  start: v.string(),
  userId: v.optional(v.id("users")),
};

export interface PlannedSeriesStep {
  appointmentTypeId: Id<"appointmentTypes">;
  appointmentTypeLineageKey: Id<"appointmentTypes">;
  appointmentTypeTitle: string;
  durationMinutes: number;
  end: string;
  locationId: Id<"locations">;
  note?: string;
  practitionerId: Id<"practitioners">;
  practitionerName: string;
  seriesStepIndex: number;
  start: string;
  stepId: string;
}

type FollowUpSearchPolicy =
  | "exact_after_previous"
  | "same_day_after_offset"
  | "target_date_or_later"
  | "target_day_only";

interface RootSeriesCandidate {
  excludedAppointmentIds?: Id<"appointments">[];
  isNewPatient?: boolean;
  locationId: Id<"locations">;
  patientDateOfBirth?: string;
  patientId?: Id<"patients">;
  practiceId: Id<"practices">;
  practitionerId: Id<"practitioners">;
  scope?: AppointmentBookingScope;
  simulationRuleSetId?: Id<"ruleSets">;
  start: string;
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
  slotCache: Map<string, SchedulingResultSlot[]>;
}

interface SeriesSpecification {
  followUpPlanSnapshot: FollowUpStep[];
  rootAppointmentType: Doc<"appointmentTypes">;
  rootDurationMinutes: number;
  ruleSetId: Id<"ruleSets">;
}

export async function createAppointmentSeries(
  ctx: MutationCtx,
  args: {
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    rootAppointmentTypeId: Id<"appointmentTypes">;
    rootReplacesAppointmentId?: Id<"appointments">;
    rootTitle: string;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: string;
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
    const conflictingAppointment = await findConflictingAppointment(ctx.db, {
      candidate: {
        end: step.end,
        locationLineageKey: step.locationId,
        practitionerLineageKey: step.practitionerId,
        start: step.start,
      },
      practiceId: args.practiceId,
      scope,
      ...(simulationRuleSetId && { simulationRuleSetId }),
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

    const storedReferences = await resolveStoredAppointmentReferencesForWrite(
      ctx.db,
      {
        appointmentTypeId: step.appointmentTypeId,
        locationId: step.locationId,
        practitionerId: step.practitionerId,
      },
    );

    const appointmentId = await ctx.db.insert("appointments", {
      ...storedReferences,
      appointmentTypeTitle: step.appointmentTypeTitle,
      createdAt: now,
      end: step.end,
      ...(scope === "simulation" && {
        isSimulation: true,
        simulationKind: "draft" as const,
        ...(simulationRuleSetId && { simulationRuleSetId }),
        simulationValidatedAt: now,
      }),
      lastModified: now,
      ...(args.patientId && { patientId: args.patientId }),
      practiceId: args.practiceId,
      ...(index === 0 &&
        args.rootReplacesAppointmentId && {
          replacesAppointmentId: args.rootReplacesAppointmentId,
        }),
      seriesId,
      seriesStepId: step.stepId,
      seriesStepIndex: toStoredSeriesStepIndex(step.seriesStepIndex),
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
    createdAt: now,
    followUpPlanSnapshot: normalizeFollowUpPlanSnapshot(
      rootAppointmentType.followUpPlan ?? [],
    ),
    lastModified: now,
    ...(patientDateOfBirth && { patientDateOfBirth }),
    ...(args.patientId && { patientId: args.patientId }),
    practiceId: args.practiceId,
    rootAppointmentId,
    rootAppointmentTypeId: rootAppointmentType._id,
    rootAppointmentTypeLineageKey:
      rootAppointmentType.lineageKey ?? rootAppointmentType._id,
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
    requestedAt: string;
    rootCandidate: RootSeriesCandidate;
    seriesSpecification: SeriesSpecification;
  },
): Promise<SeriesPlanningResult> {
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
    practitionerId: args.rootCandidate.practitionerId,
    requestedAt: args.requestedAt,
    rootDurationMinutes: args.seriesSpecification.rootDurationMinutes,
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
    appointmentTypeLineageKey:
      args.seriesSpecification.rootAppointmentType.lineageKey ??
      args.seriesSpecification.rootAppointmentType._id,
    appointmentTypeTitle: args.seriesSpecification.rootAppointmentType.name,
    durationMinutes: args.seriesSpecification.rootDurationMinutes,
    end: calculateEndTime(
      args.rootCandidate.start,
      args.seriesSpecification.rootDurationMinutes,
    ),
    locationId: args.rootCandidate.locationId,
    practitionerId: args.rootCandidate.practitionerId,
    practitionerName: validatedRoot.practitionerName,
    seriesStepIndex: 0,
    start: args.rootCandidate.start,
    stepId: "root",
  };

  const plannedSteps: PlannedSeriesStep[] = [rootStep];
  let previousStep = rootStep;

  for (const step of args.seriesSpecification.followUpPlanSnapshot) {
    const targetAppointmentType = await requireAppointmentTypeByLineageKey(
      ctx.db,
      args.seriesSpecification.ruleSetId,
      step.appointmentTypeLineageKey,
    );
    const practitionerId =
      step.practitionerMode === "inherit"
        ? previousStep.practitionerId
        : undefined;
    const locationId =
      step.locationMode === "inherit" ? previousStep.locationId : undefined;

    const matchingSlot = await findSlotForFollowUpStep(ctx, {
      ...(locationId && { locationId }),
      ...(args.rootCandidate.isNewPatient !== undefined && {
        isNewPatient: args.rootCandidate.isNewPatient,
      }),
      ...(args.rootCandidate.patientDateOfBirth && {
        patientDateOfBirth: args.rootCandidate.patientDateOfBirth,
      }),
      planningState: args.planningState,
      practiceId: args.rootCandidate.practiceId,
      previousStep,
      ...(practitionerId && { practitionerId }),
      requestedAt: args.requestedAt,
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

    if (!matchingSlot?.locationId) {
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

    const plannedStep: PlannedSeriesStep = {
      appointmentTypeId: targetAppointmentType._id,
      appointmentTypeLineageKey:
        targetAppointmentType.lineageKey ?? targetAppointmentType._id,
      appointmentTypeTitle: targetAppointmentType.name,
      durationMinutes: targetAppointmentType.duration,
      end: calculateEndTime(
        matchingSlot.startTime,
        targetAppointmentType.duration,
      ),
      locationId: matchingSlot.locationId,
      practitionerId: matchingSlot.practitionerId,
      practitionerName: matchingSlot.practitionerName,
      seriesStepIndex: plannedSteps.length,
      start: matchingSlot.startTime,
      stepId: step.stepId,
      ...(step.note ? { note: step.note } : {}),
    };

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
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    rootAppointmentTypeId: Id<"appointmentTypes">;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: string;
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
  const requestedAt = Temporal.Now.instant()
    .toZonedDateTimeISO(APPOINTMENT_TIMEZONE)
    .toString();
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
      practitionerId: args.practitionerId,
      ...(args.scope && { scope: args.scope }),
      ...(simulationRuleSetId && {
        simulationRuleSetId,
      }),
      start: args.start,
      ...(args.userId && { userId: args.userId }),
    },
    seriesSpecification: {
      followUpPlanSnapshot: normalizeFollowUpPlanSnapshot(
        rootAppointmentType.followUpPlan ?? [],
      ),
      rootAppointmentType,
      rootDurationMinutes: rootAppointmentType.duration,
      ruleSetId: args.ruleSetId,
    },
  });
}

export async function replanAppointmentSeries(
  ctx: MutationCtx,
  args: {
    excludedAppointmentIds: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    rootDurationMinutes: number;
    scope: AppointmentBookingScope;
    series: Doc<"appointmentSeries">;
    start: string;
    userId?: Id<"users">;
  },
): Promise<PlannedSeriesStep[]> {
  const rootAppointmentType = await loadRootAppointmentType(ctx, {
    practiceId: args.practiceId,
    rootAppointmentTypeId: args.series.rootAppointmentTypeId,
    ruleSetId: args.series.ruleSetIdAtBooking,
  });
  const requestedAt = Temporal.Now.instant()
    .toZonedDateTimeISO(APPOINTMENT_TIMEZONE)
    .toString();
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
      practitionerId: args.practitionerId,
      scope: args.scope,
      ...(simulationRuleSetId && { simulationRuleSetId }),
      start: args.start,
      ...(args.userId && { userId: args.userId }),
    },
    seriesSpecification: {
      followUpPlanSnapshot: normalizeFollowUpPlanSnapshot(
        args.series.followUpPlanSnapshot,
      ),
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

export function resolveFollowUpSearchPolicy(
  step: FollowUpStep,
): FollowUpSearchPolicy {
  if (step.searchMode === "exact_after_previous") {
    return "exact_after_previous";
  }

  if (step.searchMode === "same_day") {
    return "same_day_after_offset";
  }

  if (step.offsetUnit === "minutes") {
    return step.offsetValue === 0
      ? "exact_after_previous"
      : "same_day_after_offset";
  }

  return "target_date_or_later";
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

function addOffset(start: Temporal.ZonedDateTime, step: FollowUpStep) {
  switch (step.offsetUnit) {
    case "days": {
      return start.add({ days: step.offsetValue });
    }
    case "minutes": {
      return start.add({ minutes: step.offsetValue });
    }
    case "months": {
      return start.add({ months: step.offsetValue });
    }
    case "weeks": {
      return start.add({ weeks: step.offsetValue });
    }
  }
}

function appointmentSeriesError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function calculateEndTime(startTime: string, durationMinutes: number): string {
  return Temporal.ZonedDateTime.from(startTime)
    .add({ minutes: durationMinutes })
    .toString();
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

async function findSlotForFollowUpStep(
  ctx: SeriesPlannerCtx,
  args: {
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId?: Id<"locations">;
    patientDateOfBirth?: string;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    previousStep: PlannedSeriesStep;
    requestedAt: string;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    step: FollowUpStep;
    targetAppointmentType: Doc<"appointmentTypes">;
  },
) {
  if (
    args.practitionerId &&
    !args.targetAppointmentType.allowedPractitionerIds.includes(
      args.practitionerId,
    )
  ) {
    return null;
  }

  const earliestStart = addOffset(
    Temporal.ZonedDateTime.from(args.previousStep.end),
    args.step,
  );
  const searchPolicy = resolveFollowUpSearchPolicy(args.step);

  if (searchPolicy === "exact_after_previous") {
    const slots = await queryAvailableSlotsForDay(ctx, {
      appointmentType: args.targetAppointmentType,
      date: earliestStart.toPlainDate().toString(),
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      ...(args.isNewPatient !== undefined && {
        isNewPatient: args.isNewPatient,
      }),
      ...(args.locationId && { locationId: args.locationId }),
      planningState: args.planningState,
      ...(args.patientDateOfBirth && {
        patientDateOfBirth: args.patientDateOfBirth,
      }),
      practiceId: args.practiceId,
      ...(args.practitionerId && { practitionerId: args.practitionerId }),
      requestedAt: args.requestedAt,
      ruleSetId: args.ruleSetId,
      ...(args.scope && { scope: args.scope }),
      ...(args.simulationRuleSetId && {
        simulationRuleSetId: args.simulationRuleSetId,
      }),
    });

    return (
      slots.find(
        (slot) =>
          slot.startTime === earliestStart.toString() &&
          slot.locationId !== undefined,
      ) ?? null
    );
  }

  if (searchPolicy === "same_day_after_offset") {
    const slots = await queryAvailableSlotsForDay(ctx, {
      appointmentType: args.targetAppointmentType,
      date: earliestStart.toPlainDate().toString(),
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      ...(args.isNewPatient !== undefined && {
        isNewPatient: args.isNewPatient,
      }),
      ...(args.locationId && { locationId: args.locationId }),
      planningState: args.planningState,
      ...(args.patientDateOfBirth && {
        patientDateOfBirth: args.patientDateOfBirth,
      }),
      practiceId: args.practiceId,
      ...(args.practitionerId && { practitionerId: args.practitionerId }),
      requestedAt: args.requestedAt,
      ruleSetId: args.ruleSetId,
      ...(args.scope && { scope: args.scope }),
      ...(args.simulationRuleSetId && {
        simulationRuleSetId: args.simulationRuleSetId,
      }),
    });

    return (
      slots.find(
        (slot) =>
          slot.locationId !== undefined &&
          Temporal.ZonedDateTime.from(slot.startTime).epochMilliseconds >=
            earliestStart.epochMilliseconds,
      ) ?? null
    );
  }

  const searchDates = await getSearchDatesOnOrAfter(ctx, {
    earliestStart,
    ...(args.locationId && { locationId: args.locationId }),
    planningState: args.planningState,
    practiceId: args.practiceId,
    ...(args.practitionerId && { practitionerId: args.practitionerId }),
    ruleSetId: args.ruleSetId,
    searchPolicy,
  });

  for (const searchDate of searchDates) {
    const slots = await queryAvailableSlotsForDay(ctx, {
      appointmentType: args.targetAppointmentType,
      date: searchDate.toString(),
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      ...(args.isNewPatient !== undefined && {
        isNewPatient: args.isNewPatient,
      }),
      ...(args.locationId && { locationId: args.locationId }),
      planningState: args.planningState,
      ...(args.patientDateOfBirth && {
        patientDateOfBirth: args.patientDateOfBirth,
      }),
      practiceId: args.practiceId,
      ...(args.practitionerId && { practitionerId: args.practitionerId }),
      requestedAt: args.requestedAt,
      ruleSetId: args.ruleSetId,
      ...(args.scope && { scope: args.scope }),
      ...(args.simulationRuleSetId && {
        simulationRuleSetId: args.simulationRuleSetId,
      }),
    });
    const matchingSlot = slots.find((slot) => slot.locationId !== undefined);

    if (matchingSlot) {
      return matchingSlot;
    }
  }

  return null;
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
  const weekdays = [
    ...new Set(
      baseSchedules
        .filter((schedule) => schedule.practiceId === args.practiceId)
        .filter((schedule) =>
          args.locationId ? schedule.locationId === args.locationId : true,
        )
        .filter((schedule) =>
          args.practitionerId
            ? schedule.practitionerId === args.practitionerId
            : true,
        )
        .map((schedule) => schedule.dayOfWeek),
    ),
  ].toSorted((left, right) => left - right);

  args.planningState.eligibleWeekdays.set(cacheKey, weekdays);
  return weekdays;
}

function getFollowUpSearchWindow(
  earliestStart: Temporal.ZonedDateTime,
  searchPolicy: FollowUpSearchPolicy,
): {
  endDate: Temporal.PlainDate;
  startDate: Temporal.PlainDate;
} {
  const targetDate = earliestStart.toPlainDate();

  if (searchPolicy === "target_date_or_later") {
    return {
      endDate: targetDate.add({ days: MAX_SERIES_SEARCH_DAYS }),
      startDate: targetDate,
    };
  }

  return {
    endDate: targetDate,
    startDate: targetDate,
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
    searchPolicy: FollowUpSearchPolicy;
  },
) {
  const eligibleWeekdays = await getEligibleWeekdays(ctx, args);

  if (eligibleWeekdays.length === 0) {
    return [];
  }

  const { endDate, startDate } = getFollowUpSearchWindow(
    args.earliestStart,
    args.searchPolicy,
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

function normalizeFollowUpPlanSnapshot(
  followUpPlan: FollowUpStep[],
): FollowUpStep[] {
  return followUpPlan.map((step) => ({
    ...step,
    locationMode: "inherit",
    practitionerMode: "inherit",
    searchMode:
      step.offsetUnit === "minutes"
        ? step.offsetValue === 0
          ? "exact_after_previous"
          : "same_day"
        : "first_available_on_or_after",
    stepId: step.stepId.trim(),
    ...(step.note?.trim() ? { note: step.note.trim() } : {}),
  }));
}

async function queryAvailableSlotsForDay(
  ctx: Pick<MutationCtx, "runQuery"> | Pick<QueryCtx, "runQuery">,
  args: {
    appointmentType: Doc<"appointmentTypes">;
    date: string;
    excludedAppointmentIds?: Id<"appointments">[];
    isNewPatient?: boolean;
    locationId?: Id<"locations">;
    patientDateOfBirth?: string;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    requestedAt: string;
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

  const result: { log: string[]; slots: SchedulingResultSlot[] } =
    await ctx.runQuery(internal.scheduling.getSlotsForDayInternal, {
      date: args.date,
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      ...(args.scope && { scope: args.scope }),
      simulatedContext: {
        appointmentTypeId: args.appointmentType._id,
        ...(args.locationId && { locationId: args.locationId }),
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
      args.appointmentType.allowedPractitionerIds.includes(slot.practitionerId),
    )
    .filter((slot) =>
      args.practitionerId ? slot.practitionerId === args.practitionerId : true,
    )
    .filter((slot) =>
      args.locationId ? slot.locationId === args.locationId : true,
    )
    .toSorted((left, right) => left.startTime.localeCompare(right.startTime));
  args.planningState.slotCache.set(cacheKey, slots);
  return slots;
}

async function resolvePatientDateOfBirth(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  args: {
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
  },
): Promise<string | undefined> {
  if (args.patientDateOfBirth) {
    return args.patientDateOfBirth;
  }

  if (!args.patientId) {
    return undefined;
  }

  const patient = await ctx.db.get("patients", args.patientId);
  return patient?.dateOfBirth;
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
    patientDateOfBirth?: string;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    requestedAt: string;
    rootDurationMinutes: number;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulationRuleSetId?: Id<"ruleSets">;
    start: string;
  },
): Promise<
  | {
      blockedStepId: string;
      failureMessage: string;
      status: "blocked";
      steps: PlannedSeriesStep[];
    }
  | { practitionerName: string; status: "ready" }
> {
  validateDurationMinutes(args.rootDurationMinutes);

  if (
    !args.appointmentType.allowedPractitionerIds.includes(args.practitionerId)
  ) {
    return {
      blockedStepId: "root",
      failureMessage:
        "Der ausgewählte Behandler ist für diese Terminart nicht freigeschaltet.",
      status: "blocked",
      steps: [],
    };
  }

  const rootSlots = await queryAvailableSlotsForDay(ctx, {
    appointmentType: args.appointmentType,
    date: Temporal.ZonedDateTime.from(args.start).toPlainDate().toString(),
    ...(args.excludedAppointmentIds && {
      excludedAppointmentIds: args.excludedAppointmentIds,
    }),
    ...(args.isNewPatient !== undefined && { isNewPatient: args.isNewPatient }),
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

  const selectedRootSlot = rootSlots.find(
    (slot) =>
      slot.startTime === args.start &&
      slot.locationId === args.locationId &&
      slot.practitionerId === args.practitionerId,
  );

  if (!selectedRootSlot) {
    return {
      blockedStepId: "root",
      failureMessage:
        "Der ausgewählte Starttermin ist nicht mehr verfügbar oder wird durch Regeln blockiert.",
      status: "blocked",
      steps: [],
    };
  }

  const conflictingAppointment = await findConflictingAppointment(ctx.db, {
    candidate: {
      end: calculateEndTime(args.start, args.rootDurationMinutes),
      locationLineageKey: args.locationId,
      practitionerLineageKey: args.practitionerId,
      start: args.start,
    },
    ...(args.excludedAppointmentIds && {
      excludeAppointmentIds: args.excludedAppointmentIds,
    }),
    practiceId: args.practiceId,
    scope: args.scope ?? "real",
    ...(args.simulationRuleSetId && {
      simulationRuleSetId: args.simulationRuleSetId,
    }),
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
    practitionerName: selectedRootSlot.practitionerName,
    status: "ready",
  };
}
