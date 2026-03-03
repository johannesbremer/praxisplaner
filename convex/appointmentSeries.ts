import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { SchedulingResultSlot } from "./scheduling";

import { internal } from "./_generated/api";
import {
  type AppointmentBookingScope,
  findConflictingAppointment,
} from "./appointmentConflicts";
import {
  type FollowUpStep,
  requireAppointmentTypeByLineageKey,
} from "./followUpPlans";

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
  locationId: v.id("locations"),
  patientDateOfBirth: v.optional(v.string()),
  patientId: v.optional(v.id("patients")),
  practiceId: v.id("practices"),
  practitionerId: v.id("practitioners"),
  rootAppointmentTypeId: v.id("appointmentTypes"),
  ruleSetId: v.id("ruleSets"),
  scope: v.optional(v.union(v.literal("real"), v.literal("simulation"))),
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

type SeriesPlannerCtx =
  | Pick<MutationCtx, "db" | "runQuery">
  | Pick<QueryCtx, "db" | "runQuery">;

interface SeriesPlanningState {
  baseSchedulesByRuleSet: Map<Id<"ruleSets">, Promise<Doc<"baseSchedules">[]>>;
  eligibleWeekdays: Map<string, number[]>;
  slotCache: Map<string, SchedulingResultSlot[]>;
}

export async function createAppointmentSeries(
  ctx: MutationCtx,
  args: {
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
    start: string;
    userId?: Id<"users">;
  },
) {
  const planningState = createSeriesPlanningState();
  const preview = await previewAppointmentSeries(ctx, args, planningState);
  if (preview.status === "blocked") {
    throw new Error(
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

  for (const [index, step] of preview.steps.entries()) {
    const conflictingAppointment = await findConflictingAppointment(ctx.db, {
      candidate: {
        end: step.end,
        locationId: step.locationId,
        practitionerId: step.practitionerId,
        start: step.start,
      },
      practiceId: args.practiceId,
      scope,
      ...(index === 0 &&
        args.rootReplacesAppointmentId && {
          excludeAppointmentIds: [args.rootReplacesAppointmentId],
        }),
    });

    if (conflictingAppointment) {
      throw new Error(
        `Der Termin fuer Schritt ${step.seriesStepIndex + 1} ist nicht mehr verfuegbar.`,
      );
    }

    const appointmentId = await ctx.db.insert("appointments", {
      appointmentTypeId: step.appointmentTypeId,
      appointmentTypeTitle: step.appointmentTypeTitle,
      createdAt: now,
      end: step.end,
      ...(scope === "simulation" && { isSimulation: true }),
      lastModified: now,
      locationId: step.locationId,
      ...(args.patientId && { patientId: args.patientId }),
      practiceId: args.practiceId,
      practitionerId: step.practitionerId,
      ...(index === 0 &&
        args.rootReplacesAppointmentId && {
          replacesAppointmentId: args.rootReplacesAppointmentId,
        }),
      seriesId,
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
    throw new Error(
      "The appointment series did not create a root appointment.",
    );
  }

  return {
    appointmentIds,
    rootAppointmentId,
    seriesId,
    steps: createdSteps,
  };
}

export async function previewAppointmentSeries(
  ctx: SeriesPlannerCtx,
  args: {
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId: Id<"practitioners">;
    rootAppointmentTypeId: Id<"appointmentTypes">;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    start: string;
    userId?: Id<"users">;
  },
  planningState = createSeriesPlanningState(),
) {
  void args.userId;

  const rootAppointmentType = await loadRootAppointmentType(ctx, args);
  if (
    !rootAppointmentType.allowedPractitionerIds.includes(args.practitionerId)
  ) {
    return {
      blockedStepId: "root",
      failureMessage:
        "Der ausgewählte Behandler ist für diese Terminart nicht freigeschaltet.",
      status: "blocked" as const,
      steps: [],
    };
  }

  const patientDateOfBirth = await resolvePatientDateOfBirth(ctx, {
    ...(args.patientDateOfBirth && {
      patientDateOfBirth: args.patientDateOfBirth,
    }),
    ...(args.patientId && { patientId: args.patientId }),
  });
  const requestedAt = Temporal.Now.instant()
    .toZonedDateTimeISO(APPOINTMENT_TIMEZONE)
    .toString();
  const rootStart = Temporal.ZonedDateTime.from(args.start);

  const rootSlots = await queryAvailableSlotsForDay(ctx, {
    appointmentType: rootAppointmentType,
    date: rootStart.toPlainDate().toString(),
    locationId: args.locationId,
    planningState,
    ...(patientDateOfBirth && { patientDateOfBirth }),
    practiceId: args.practiceId,
    practitionerId: args.practitionerId,
    requestedAt,
    ruleSetId: args.ruleSetId,
    ...(args.scope && { scope: args.scope }),
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
      status: "blocked" as const,
      steps: [],
    };
  }

  const rootStep: PlannedSeriesStep = {
    appointmentTypeId: rootAppointmentType._id,
    appointmentTypeLineageKey:
      rootAppointmentType.lineageKey ?? rootAppointmentType._id,
    appointmentTypeTitle: rootAppointmentType.name,
    durationMinutes: rootAppointmentType.duration,
    end: calculateEndTime(args.start, rootAppointmentType.duration),
    locationId: args.locationId,
    practitionerId: args.practitionerId,
    practitionerName: selectedRootSlot.practitionerName,
    seriesStepIndex: 0,
    start: args.start,
    stepId: "root",
  };

  const plannedSteps: PlannedSeriesStep[] = [rootStep];
  let previousStep = rootStep;

  for (const step of rootAppointmentType.followUpPlan ?? []) {
    const targetAppointmentType = await requireAppointmentTypeByLineageKey(
      ctx.db,
      args.ruleSetId,
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
      ...(patientDateOfBirth && { patientDateOfBirth }),
      planningState,
      practiceId: args.practiceId,
      previousStep,
      ...(practitionerId && { practitionerId }),
      requestedAt,
      ruleSetId: args.ruleSetId,
      ...(args.scope && { scope: args.scope }),
      step,
      targetAppointmentType,
    });

    if (!matchingSlot?.locationId) {
      if (step.required) {
        return {
          blockedStepId: step.stepId,
          failureMessage: `Kein verfügbarer Kettentermin für "${targetAppointmentType.name}" gefunden.`,
          status: "blocked" as const,
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
    status: "ready" as const,
    steps: plannedSteps,
  };
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

function findFirstSlotOnDate(
  slots: SchedulingResultSlot[],
  searchDate: Temporal.PlainDate,
) {
  return (
    slots.find(
      (slot) =>
        slot.locationId !== undefined &&
        Temporal.ZonedDateTime.from(slot.startTime)
          .toPlainDate()
          .equals(searchDate),
    ) ?? null
  );
}

async function findSlotForFollowUpStep(
  ctx: SeriesPlannerCtx,
  args: {
    locationId?: Id<"locations">;
    patientDateOfBirth?: string;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    previousStep: PlannedSeriesStep;
    requestedAt: string;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    step: FollowUpStep;
    targetAppointmentType: Doc<"appointmentTypes">;
  },
) {
  const earliestStart = addOffset(
    Temporal.ZonedDateTime.from(args.previousStep.end),
    args.step,
  );

  if (args.step.searchMode === "exact_after_previous") {
    const slots = await queryAvailableSlotsForDay(ctx, {
      appointmentType: args.targetAppointmentType,
      date: earliestStart.toPlainDate().toString(),
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
    });

    return (
      slots.find(
        (slot) =>
          slot.startTime === earliestStart.toString() &&
          slot.locationId !== undefined,
      ) ?? null
    );
  }

  if (args.step.searchMode === "same_day") {
    const slots = await queryAvailableSlotsForDay(ctx, {
      appointmentType: args.targetAppointmentType,
      date: earliestStart.toPlainDate().toString(),
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
    step: args.step,
  });

  for (const searchDate of searchDates) {
    const slots = await queryAvailableSlotsForDay(ctx, {
      appointmentType: args.targetAppointmentType,
      date: searchDate.toString(),
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
    });

    const matchingSlot =
      findFirstSlotOnDate(slots, searchDate) ??
      slots.find((slot) => slot.locationId !== undefined);

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
  step: FollowUpStep,
): {
  endDate: Temporal.PlainDate;
  startDate: Temporal.PlainDate;
} {
  const targetDate = earliestStart.toPlainDate();

  switch (step.offsetUnit) {
    case "days": {
      return {
        endDate: targetDate,
        startDate: targetDate,
      };
    }
    case "minutes": {
      return {
        endDate: targetDate,
        startDate: targetDate,
      };
    }
    case "months": {
      return {
        endDate: targetDate.add({ days: MAX_SERIES_SEARCH_DAYS }),
        startDate: targetDate,
      };
    }
    case "weeks": {
      return {
        endDate: targetDate.add({ days: MAX_SERIES_SEARCH_DAYS }),
        startDate: targetDate,
      };
    }
  }
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
    step: FollowUpStep;
  },
) {
  const eligibleWeekdays = await getEligibleWeekdays(ctx, args);

  if (eligibleWeekdays.length === 0) {
    return [];
  }

  const { endDate, startDate } = getFollowUpSearchWindow(
    args.earliestStart,
    args.step,
  );
  const totalDays = startDate.until(endDate).days;
  if (totalDays > MAX_SERIES_SEARCH_DAYS) {
    throw new Error(
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
    throw new Error("Appointment type not found");
  }

  if (appointmentType.practiceId !== args.practiceId) {
    throw new Error("Appointment type does not belong to this practice");
  }

  if (appointmentType.ruleSetId !== args.ruleSetId) {
    throw new Error("Appointment type does not belong to this rule set");
  }

  return appointmentType;
}

async function queryAvailableSlotsForDay(
  ctx: Pick<MutationCtx, "runQuery"> | Pick<QueryCtx, "runQuery">,
  args: {
    appointmentType: Doc<"appointmentTypes">;
    date: string;
    locationId?: Id<"locations">;
    patientDateOfBirth?: string;
    planningState: SeriesPlanningState;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    requestedAt: string;
    ruleSetId: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
  },
) {
  const cacheKey = [
    args.appointmentType._id,
    args.date,
    args.locationId ?? "",
    args.patientDateOfBirth ?? "",
    args.practiceId,
    args.practitionerId ?? "",
    args.requestedAt,
    args.ruleSetId,
    args.scope ?? "real",
  ].join("|");
  const cachedSlots = args.planningState.slotCache.get(cacheKey);
  if (cachedSlots) {
    return cachedSlots;
  }

  const result = await ctx.runQuery(
    internal.scheduling.getSlotsForDayInternal,
    {
      date: args.date,
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
          isNew: false,
        },
        requestedAt: args.requestedAt,
      },
    },
  );

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

function toStoredSeriesStepIndex(seriesStepIndex: number): bigint {
  if (!Number.isInteger(seriesStepIndex) || seriesStepIndex < 0) {
    throw new Error(
      `[APPOINTMENT_SERIES:INVALID_STEP_INDEX] Ungueltiger seriesStepIndex ${seriesStepIndex}.`,
    );
  }

  return BigInt(seriesStepIndex);
}
