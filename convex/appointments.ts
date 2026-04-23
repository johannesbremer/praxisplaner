import { ConvexError, type Infer, v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { IsoDateString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";
import type {
  DatabaseReader,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import type { TypedDateTimeRange, ZonedDateTimeString } from "./typedDtos";

import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  type AppointmentBookingScope,
  findConflictingAppointment,
  getOccupancyViewForBookingScope,
} from "./appointmentConflicts";
import {
  resolveAppointmentTypeIdForRuleSetByLineage,
  resolveAppointmentTypeLineageKey,
  resolveLocationIdForRuleSetByLineage,
  resolveLocationLineageKey,
  resolvePractitionerIdForRuleSetByLineage,
  resolveStoredAppointmentReferencesForWrite,
} from "./appointmentReferences";
import {
  appointmentSeriesArgsValidator,
  appointmentSeriesCreateResultValidator,
  appointmentSeriesPreviewResultValidator,
  createAppointmentSeries as createAppointmentSeriesHelper,
  previewAppointmentSeries as previewAppointmentSeriesHelper,
  replanAppointmentSeries,
} from "./appointmentSeries";
import {
  type AppointmentSimulationKind,
  appointmentSimulationKindValidator,
  isActivationBoundSimulation,
} from "./appointmentSimulation";
import {
  asAppointmentTypeId,
  asAppointmentTypeLineageKey,
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
} from "./identity";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  getAccessiblePracticeIdsForQuery,
} from "./practiceAccess";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import { createTemporaryPatientRecord } from "./temporaryPatients";
import {
  asOptionalIsoDateString,
  asTypedDateTimeRange,
  asZonedDateTimeString,
} from "./typedDtos";
import {
  ensureAuthenticatedIdentity,
  ensureAuthenticatedUserId,
  getAuthenticatedUserIdForQuery,
} from "./userIdentity";

type AppointmentDoc = Doc<"appointments">;
type AppointmentListItem = AppointmentResult &
  Pick<
    AppointmentDoc,
    | "cancelledAt"
    | "isSimulation"
    | "replacesAppointmentId"
    | "simulationKind"
    | "simulationRuleSetId"
  >;
type AppointmentScope = "all" | "real" | "simulation";
type AppointmentSeriesDoc = Doc<"appointmentSeries">;

type BlockedSlotDoc = Doc<"blockedSlots">;
const APPOINTMENT_TIMEZONE = "Europe/Berlin";

interface TrustedAppointmentInput {
  appointmentTypeId: Id<"appointmentTypes">;
  isNewPatient?: boolean;
  isSimulation?: boolean;
  locationId: Id<"locations">;
  patientDateOfBirth?: IsoDateString;
  patientId?: Id<"patients">;
  practiceId: Id<"practices">;
  practitionerId?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  simulationKind?: AppointmentSimulationKind;
  simulationRuleSetId?: Id<"ruleSets">;
  start: ZonedDateTimeString;
  temporaryPatientName?: string;
  temporaryPatientPhoneNumber?: string;
  title: string;
  userId?: Id<"users">;
}

const appointmentResultValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("appointments"),
  appointmentTypeId: v.id("appointmentTypes"),
  appointmentTypeTitle: v.string(),
  createdAt: v.int64(),
  end: v.string(),
  isSimulation: v.optional(v.boolean()),
  lastModified: v.int64(),
  locationId: v.id("locations"),
  patientId: v.optional(v.id("patients")),
  practiceId: v.id("practices"),
  practitionerId: v.optional(v.id("practitioners")),
  reassignmentSourceVacationLineageKey: v.optional(v.id("vacations")),
  replacesAppointmentId: v.optional(v.id("appointments")),
  seriesId: v.optional(v.string()),
  seriesStepId: v.optional(v.string()),
  seriesStepIndex: v.optional(v.int64()),
  simulationKind: v.optional(appointmentSimulationKindValidator),
  simulationRuleSetId: v.optional(v.id("ruleSets")),
  simulationValidatedAt: v.optional(v.int64()),
  start: v.string(),
  title: v.string(),
  userId: v.optional(v.id("users")),
});

const blockedSlotListItemValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("blockedSlots"),
  createdAt: v.int64(),
  end: v.string(),
  isSimulation: v.optional(v.boolean()),
  lastModified: v.int64(),
  locationId: v.id("locations"),
  practiceId: v.id("practices"),
  practitionerId: v.optional(v.id("practitioners")),
  replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
  start: v.string(),
  title: v.string(),
});

const calendarDayQueryArgsValidator = {
  activeRuleSetId: v.optional(v.id("ruleSets")),
  dayEnd: v.string(),
  dayStart: v.string(),
  locationId: v.optional(v.id("locations")),
  practiceId: v.id("practices"),
  scope: v.optional(
    v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
  ),
  selectedRuleSetId: v.optional(v.id("ruleSets")),
};

export type AppointmentResult = Omit<
  Infer<typeof appointmentResultValidator>,
  "end" | "start"
> &
  TypedDateTimeRange;

function appointmentChainError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function asTrustedAppointmentInput(args: {
  appointmentTypeId: Id<"appointmentTypes">;
  isNewPatient?: boolean;
  isSimulation?: boolean;
  locationId: Id<"locations">;
  patientDateOfBirth?: string;
  patientId?: Id<"patients">;
  practiceId: Id<"practices">;
  practitionerId?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  simulationKind?: AppointmentSimulationKind;
  simulationRuleSetId?: Id<"ruleSets">;
  start: string;
  temporaryPatientName?: string;
  temporaryPatientPhoneNumber?: string;
  title: string;
  userId?: Id<"users">;
}): TrustedAppointmentInput {
  const { patientDateOfBirth: rawPatientDateOfBirth, start, ...rest } = args;
  const patientDateOfBirth = asOptionalIsoDateString(rawPatientDateOfBirth);
  return {
    ...rest,
    ...(patientDateOfBirth !== undefined && { patientDateOfBirth }),
    start: asZonedDateTimeString(start),
  };
}

function calculateDurationMinutes(
  end: ZonedDateTimeString,
  start: ZonedDateTimeString,
): number {
  const minutes =
    (Temporal.ZonedDateTime.from(end).epochMilliseconds -
      Temporal.ZonedDateTime.from(start).epochMilliseconds) /
    60_000;

  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw appointmentChainError(
      "CHAIN_REPLAN_FAILED",
      "Die Terminlänge muss eine positive ganze Zahl sein.",
    );
  }

  return minutes;
}

function calculateEndFromDuration(
  start: ZonedDateTimeString,
  durationMinutes: number,
): ZonedDateTimeString {
  return asZonedDateTimeString(
    Temporal.ZonedDateTime.from(start)
      .add({ minutes: durationMinutes })
      .toString(),
  );
}

function calculateShiftedEnd(
  end: ZonedDateTimeString,
  start: ZonedDateTimeString,
  nextStart: ZonedDateTimeString,
): ZonedDateTimeString {
  const durationMinutes = calculateDurationMinutes(end, start);
  return asZonedDateTimeString(
    Temporal.ZonedDateTime.from(nextStart)
      .add({ minutes: durationMinutes })
      .toString(),
  );
}

async function getAppointmentSeriesRecord(
  db: DatabaseReader,
  seriesId: string,
): Promise<AppointmentSeriesDoc | null> {
  return await db
    .query("appointmentSeries")
    .withIndex("by_seriesId", (q) => q.eq("seriesId", seriesId))
    .first();
}

async function getSeriesAppointments(
  db: DatabaseReader,
  seriesId: string,
): Promise<AppointmentDoc[]> {
  const appointments = await db
    .query("appointments")
    .withIndex("by_seriesId", (q) => q.eq("seriesId", seriesId))
    .collect();

  return appointments.toSorted((left, right) => {
    const leftIndex = Number(left.seriesStepIndex ?? 0n);
    const rightIndex = Number(right.seriesStepIndex ?? 0n);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.start.localeCompare(right.start);
  });
}

function getSeriesStepKey(appointment: AppointmentDoc): string {
  if (appointment.seriesStepId) {
    return appointment.seriesStepId;
  }

  if (appointment.seriesStepIndex === 0n) {
    return "root";
  }

  return `index:${Number(appointment.seriesStepIndex ?? 0n)}`;
}

function isAppointmentCancelled(
  appointment: Pick<AppointmentDoc, "cancelledAt">,
): boolean {
  return appointment.cancelledAt !== undefined;
}

function isAppointmentInFuture(
  appointment: AppointmentDoc,
  nowEpochMilliseconds: number,
): boolean {
  try {
    return (
      Temporal.ZonedDateTime.from(appointment.start).epochMilliseconds >
      nowEpochMilliseconds
    );
  } catch {
    return false;
  }
}

function isVisibleAppointment(
  appointment: Pick<AppointmentDoc, "cancelledAt">,
): boolean {
  return !isAppointmentCancelled(appointment);
}

function requireEntityUsableForNewAppointment<
  T extends { deleted?: boolean },
>(params: {
  entity: null | T | undefined;
  entityId: string;
  entityLabel: "Behandler" | "Standort" | "Terminart";
}): T {
  if (!params.entity) {
    throw new Error(
      `${params.entityLabel} mit ID ${params.entityId} nicht gefunden`,
    );
  }
  if (isRuleSetEntityDeleted(params.entity)) {
    throw new Error(
      `${params.entityLabel} mit ID ${params.entityId} wurde gelöscht und kann nicht mehr neu referenziert werden.`,
    );
  }
  return params.entity;
}

async function resolveAppointmentTypeIdForDisplayRuleSet(
  db: DatabaseReader,
  appointmentTypeLineageKey: Id<"appointmentTypes">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"appointmentTypes">> {
  return await resolveAppointmentTypeIdForRuleSetByLineage(db, {
    lineageKey: asAppointmentTypeLineageKey(appointmentTypeLineageKey),
    ruleSetId: targetRuleSetId,
  });
}

async function resolveLocationIdForDisplayRuleSet(
  db: DatabaseReader,
  locationLineageKey: Id<"locations">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"locations">> {
  return await resolveLocationIdForRuleSetByLineage(db, {
    lineageKey: asLocationLineageKey(locationLineageKey),
    ruleSetId: targetRuleSetId,
  });
}

async function resolvePractitionerIdForDisplayRuleSet(
  db: DatabaseReader,
  practitionerLineageKey: Id<"practitioners">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"practitioners">> {
  return await resolvePractitionerIdForRuleSetByLineage(db, {
    lineageKey: asPractitionerLineageKey(practitionerLineageKey),
    ruleSetId: targetRuleSetId,
  });
}

async function resolvePreferredAppointmentPatientDateOfBirth(
  db: DatabaseReader,
  args: {
    patientId?: Id<"patients">;
    provisionalDateOfBirth?: IsoDateString;
  },
): Promise<IsoDateString | undefined> {
  if (args.patientId) {
    const patient = await db.get("patients", args.patientId);
    return asOptionalIsoDateString(patient?.dateOfBirth);
  }

  return args.provisionalDateOfBirth;
}

/**
 * Resolves blocked-slot references into the displayed rule set via lineage.
 */
async function remapBlockedSlotIds(
  ctx: { db: DatabaseReader },
  blockedSlots: BlockedSlotDoc[],
  targetRuleSetId: Id<"ruleSets">,
): Promise<BlockedSlotDoc[]> {
  const remappedSlots = await Promise.all(
    blockedSlots.map(async (slot) => {
      try {
        const remappedSlot: BlockedSlotDoc = {
          ...slot,
          locationId: await resolveLocationIdForDisplayRuleSet(
            ctx.db,
            slot.locationId,
            targetRuleSetId,
          ),
        };
        if (slot.practitionerId) {
          remappedSlot.practitionerId =
            await resolvePractitionerIdForDisplayRuleSet(
              ctx.db,
              slot.practitionerId,
              targetRuleSetId,
            );
        }
        return remappedSlot;
      } catch (error) {
        if (isMissingDisplayLineageMappingError(error)) {
          return null;
        }
        throw error;
      }
    }),
  );

  return remappedSlots.filter((slot): slot is BlockedSlotDoc => slot !== null);
}

/**
 * Remaps entity IDs in appointments from source rule set to target rule set.
 */
function combineBlockedSlotsForSimulation(
  blockedSlots: BlockedSlotDoc[],
): BlockedSlotDoc[] {
  const simulationSlots = blockedSlots.filter(
    (slot) => slot.isSimulation === true,
  );

  const replacedIds = new Set(
    simulationSlots.map((slot) => slot.replacesBlockedSlotId).filter(Boolean),
  );

  const realSlots = blockedSlots.filter(
    (slot) => slot.isSimulation !== true && !replacedIds.has(slot._id),
  );

  const merged = [...realSlots, ...simulationSlots];

  return merged.toSorted((a, b) => a.start.localeCompare(b.start));
}

function combineForSimulationScope(
  appointments: AppointmentListItem[],
): AppointmentListItem[] {
  const simulationAppointments = appointments.filter(
    (appointment) => appointment.isSimulation === true,
  );

  const replacedIds = new Set(
    simulationAppointments
      .map((appointment) => appointment.replacesAppointmentId)
      .filter(Boolean),
  );

  const realAppointments = appointments.filter(
    (appointment) =>
      appointment.isSimulation !== true && !replacedIds.has(appointment._id),
  );

  const merged = [...realAppointments, ...simulationAppointments];

  return merged.toSorted((a, b) => a.start.localeCompare(b.start));
}

function filterAppointmentsForScope<T extends AppointmentDoc>(
  appointments: T[],
  args: {
    activeRuleSetId?: Id<"ruleSets">;
    selectedRuleSetId?: Id<"ruleSets">;
  },
  scope: AppointmentScope,
) {
  return appointments.filter((appointment) =>
    isAppointmentVisibleInScope(appointment, args, scope),
  );
}

function getDisplayRuleSetId(args: {
  activeRuleSetId?: Id<"ruleSets">;
  selectedRuleSetId?: Id<"ruleSets">;
}) {
  return args.selectedRuleSetId ?? args.activeRuleSetId;
}

async function getOptionalLocationLineageKey(
  db: DatabaseReader,
  locationId: Id<"locations"> | undefined,
): Promise<Id<"locations"> | undefined> {
  if (!locationId) {
    return;
  }

  return await resolveLocationLineageKey(db, asLocationId(locationId));
}

function getSimulationScopeRuleSetId(args: {
  activeRuleSetId?: Id<"ruleSets">;
  selectedRuleSetId?: Id<"ruleSets">;
}) {
  return args.selectedRuleSetId ?? args.activeRuleSetId;
}

function isAppointmentVisibleInScope(
  appointment: Pick<AppointmentDoc, "isSimulation" | "simulationRuleSetId">,
  args: {
    activeRuleSetId?: Id<"ruleSets">;
    selectedRuleSetId?: Id<"ruleSets">;
  },
  scope: AppointmentScope,
) {
  if (scope === "real") {
    return appointment.isSimulation !== true;
  }

  return (
    appointment.isSimulation !== true ||
    appointment.simulationRuleSetId === getSimulationScopeRuleSetId(args)
  );
}

function isCalendarDayRangeMatch(
  args: { dayEnd: string; dayStart: string },
  value: string,
): boolean {
  return value >= args.dayStart && value < args.dayEnd;
}

function isMissingDisplayLineageMappingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("im Regelset") &&
    error.message.includes("nicht gefunden")
  );
}

async function remapAppointmentIds(
  ctx: { db: DatabaseReader },
  appointments: AppointmentDoc[],
  targetRuleSetId: Id<"ruleSets">,
): Promise<AppointmentListItem[]> {
  const remappedAppointments = await Promise.all(
    appointments.map(async (appointment) => {
      try {
        const remappedAppointment: AppointmentListItem = {
          ...toAppointmentListItem(appointment),
          appointmentTypeId: await resolveAppointmentTypeIdForDisplayRuleSet(
            ctx.db,
            appointment.appointmentTypeLineageKey,
            targetRuleSetId,
          ),
          locationId: await resolveLocationIdForDisplayRuleSet(
            ctx.db,
            appointment.locationLineageKey,
            targetRuleSetId,
          ),
        };
        if (appointment.practitionerLineageKey) {
          remappedAppointment.practitionerId =
            await resolvePractitionerIdForDisplayRuleSet(
              ctx.db,
              appointment.practitionerLineageKey,
              targetRuleSetId,
            );
        }
        return remappedAppointment;
      } catch (error) {
        if (isMissingDisplayLineageMappingError(error)) {
          return null;
        }
        throw error;
      }
    }),
  );

  return remappedAppointments.filter(
    (appointment): appointment is AppointmentListItem => appointment !== null,
  );
}

function toAppointmentListItem(
  appointment: AppointmentDoc,
): AppointmentListItem {
  const timeRange = asTypedDateTimeRange(appointment);
  return {
    _creationTime: appointment._creationTime,
    _id: appointment._id,
    appointmentTypeId: appointment.appointmentTypeLineageKey,
    appointmentTypeTitle: appointment.appointmentTypeTitle,
    createdAt: appointment.createdAt,
    ...timeRange,
    lastModified: appointment.lastModified,
    locationId: appointment.locationLineageKey,
    practiceId: appointment.practiceId,
    ...(appointment.cancelledAt === undefined
      ? {}
      : { cancelledAt: appointment.cancelledAt }),
    ...(appointment.isSimulation === undefined
      ? {}
      : { isSimulation: appointment.isSimulation }),
    ...(appointment.patientId === undefined
      ? {}
      : { patientId: appointment.patientId }),
    ...(appointment.practitionerLineageKey
      ? { practitionerId: appointment.practitionerLineageKey }
      : {}),
    ...(appointment.reassignmentSourceVacationLineageKey === undefined
      ? {}
      : {
          reassignmentSourceVacationLineageKey:
            appointment.reassignmentSourceVacationLineageKey,
        }),
    ...(appointment.replacesAppointmentId === undefined
      ? {}
      : { replacesAppointmentId: appointment.replacesAppointmentId }),
    ...(appointment.seriesId === undefined
      ? {}
      : { seriesId: appointment.seriesId }),
    ...(appointment.seriesStepId === undefined
      ? {}
      : { seriesStepId: appointment.seriesStepId }),
    ...(appointment.seriesStepIndex === undefined
      ? {}
      : { seriesStepIndex: appointment.seriesStepIndex }),
    ...(appointment.simulationKind === undefined
      ? {}
      : { simulationKind: appointment.simulationKind }),
    ...(appointment.simulationRuleSetId === undefined
      ? {}
      : { simulationRuleSetId: appointment.simulationRuleSetId }),
    ...(appointment.simulationValidatedAt === undefined
      ? {}
      : { simulationValidatedAt: appointment.simulationValidatedAt }),
    title: appointment.title,
    ...(appointment.userId === undefined ? {} : { userId: appointment.userId }),
  };
}

// Query to get all appointments
export const getAppointments = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    const scope: AppointmentScope = args.scope ?? "real";

    const appointmentDocs = await ctx.db
      .query("appointments")
      .order("asc")
      .collect();
    const visibleAppointments = appointmentDocs.filter(
      (appointment) =>
        accessiblePracticeIds.has(appointment.practiceId) &&
        isVisibleAppointment(appointment),
    );
    const scopedAppointments = filterAppointmentsForScope(
      visibleAppointments,
      args,
      scope,
    );
    const displayRuleSetId = getDisplayRuleSetId(args);
    const appointments: AppointmentListItem[] = displayRuleSetId
      ? await remapAppointmentIds(ctx, scopedAppointments, displayRuleSetId)
      : scopedAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        );

    let resultAppointments: AppointmentListItem[];

    if (scope === "simulation") {
      resultAppointments = combineForSimulationScope(appointments);
    } else if (scope === "all") {
      resultAppointments = appointments.toSorted((a, b) =>
        a.start.localeCompare(b.start),
      );
    } else {
      resultAppointments = appointments.toSorted((a, b) =>
        a.start.localeCompare(b.start),
      );
    }

    return resultAppointments;
  },
  returns: v.array(appointmentResultValidator),
});

export const getCalendarDayAppointments = query({
  args: calendarDayQueryArgsValidator,
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);

    const scope: AppointmentScope = args.scope ?? "real";
    const selectedLocationLineageKey = await getOptionalLocationLineageKey(
      ctx.db,
      args.locationId,
    );

    const appointmentDocs = await ctx.db
      .query("appointments")
      .withIndex("by_practiceId_start", (q) =>
        q.eq("practiceId", args.practiceId).gte("start", args.dayStart),
      )
      .collect();

    const visibleAppointments = appointmentDocs.filter(
      (appointment) =>
        isVisibleAppointment(appointment) &&
        isCalendarDayRangeMatch(args, appointment.start) &&
        (selectedLocationLineageKey === undefined ||
          appointment.locationLineageKey === selectedLocationLineageKey),
    );
    const scopedAppointments = filterAppointmentsForScope(
      visibleAppointments,
      args,
      scope,
    );
    const displayRuleSetId = getDisplayRuleSetId(args);
    const appointments = displayRuleSetId
      ? await remapAppointmentIds(ctx, scopedAppointments, displayRuleSetId)
      : scopedAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        );

    return scope === "simulation"
      ? combineForSimulationScope(appointments)
      : appointments.toSorted((left, right) =>
          left.start.localeCompare(right.start),
        );
  },
  returns: v.array(appointmentResultValidator),
});

// Query to get appointments in a date range
export const getAppointmentsInRange = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    end: v.string(),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
    start: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    // Use index range query instead of filter for better performance
    const appointmentDocs = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) => q.gte("start", args.start))
      .collect();

    // Filter in code for end date (more efficient than .filter())
    const filteredAppointments = appointmentDocs.filter(
      (appointment) =>
        appointment.start <= args.end &&
        accessiblePracticeIds.has(appointment.practiceId) &&
        isVisibleAppointment(appointment),
    );
    const scope: AppointmentScope = args.scope ?? "real";
    const scopedAppointments = filterAppointmentsForScope(
      filteredAppointments,
      args,
      scope,
    );

    const displayRuleSetId = getDisplayRuleSetId(args);
    const appointments: AppointmentListItem[] = displayRuleSetId
      ? await remapAppointmentIds(ctx, scopedAppointments, displayRuleSetId)
      : scopedAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        );

    if (scope === "simulation") {
      return combineForSimulationScope(appointments);
    }

    if (scope === "all") {
      return appointments.toSorted((a, b) => a.start.localeCompare(b.start));
    }

    return appointments.toSorted((a, b) => a.start.localeCompare(b.start));
  },
  returns: v.array(appointmentResultValidator),
});

export const previewAppointmentSeries = query({
  args: appointmentSeriesArgsValidator,
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const { patientDateOfBirth: rawPatientDateOfBirth, start, ...rest } = args;
    const patientDateOfBirth = asOptionalIsoDateString(rawPatientDateOfBirth);
    return await previewAppointmentSeriesHelper(ctx, {
      ...rest,
      ...(patientDateOfBirth !== undefined && { patientDateOfBirth }),
      start: asZonedDateTimeString(start),
    });
  },
  returns: appointmentSeriesPreviewResultValidator,
});

export const createAppointmentSeries = mutation({
  args: {
    ...appointmentSeriesArgsValidator,
    rootReplacesAppointmentId: v.optional(v.id("appointments")),
    rootTitle: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);

    if (!args.patientId && !args.userId) {
      throw new Error("Either patientId or userId must be provided.");
    }

    if (args.patientId) {
      const patient = await ctx.db.get("patients", args.patientId);
      if (!patient) {
        throw new Error(`Patient with ID ${args.patientId} not found`);
      }
    }

    if (args.userId) {
      const user = await ctx.db.get("users", args.userId);
      if (!user) {
        throw new Error(`User with ID ${args.userId} not found`);
      }
    }

    const { patientDateOfBirth: rawPatientDateOfBirth, start, ...rest } = args;
    const patientDateOfBirth = asOptionalIsoDateString(rawPatientDateOfBirth);
    return await createAppointmentSeriesHelper(ctx, {
      ...rest,
      ...(patientDateOfBirth !== undefined && { patientDateOfBirth }),
      rootTitle: args.rootTitle.trim(),
      start: asZonedDateTimeString(start),
    });
  },
  returns: appointmentSeriesCreateResultValidator,
});

export async function createAppointmentFromTrustedSource(
  ctx: MutationCtx,
  rawArgs: {
    appointmentTypeId: Id<"appointmentTypes">;
    isNewPatient?: boolean;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesAppointmentId?: Id<"appointments">;
    simulationKind?: AppointmentSimulationKind;
    simulationRuleSetId?: Id<"ruleSets">;
    start: string;
    temporaryPatientName?: string;
    temporaryPatientPhoneNumber?: string;
    title: string;
    userId?: Id<"users">;
  },
) {
  const args = asTrustedAppointmentInput(rawArgs);
  const now = BigInt(Date.now());
  const {
    appointmentTypeId,
    isNewPatient,
    isSimulation,
    locationId,
    patientDateOfBirth,
    patientId,
    practiceId,
    practitionerId,
    replacesAppointmentId,
    simulationKind,
    simulationRuleSetId,
    temporaryPatientName,
    temporaryPatientPhoneNumber,
    userId,
    ...rest
  } = args;

  if (replacesAppointmentId && isSimulation !== true) {
    throw new Error(
      "Only simulated appointments can replace existing appointments.",
    );
  }

  const hasTemporaryPatientData =
    temporaryPatientName !== undefined ||
    temporaryPatientPhoneNumber !== undefined;

  if ((patientId || userId) && hasTemporaryPatientData) {
    throw new Error(
      "Temporäre Patientendaten können nicht zusammen mit patientId oder userId übergeben werden.",
    );
  }

  let resolvedPatientId = patientId;
  let resolvedUserId = userId;
  const allowsMissingLinkedRecords =
    isSimulation === true && replacesAppointmentId !== undefined;

  if (!resolvedPatientId && !resolvedUserId) {
    if (
      temporaryPatientName === undefined ||
      temporaryPatientPhoneNumber === undefined
    ) {
      throw new Error(
        "Either patientId, userId, or temporary patient data must be provided.",
      );
    }

    resolvedPatientId = await createTemporaryPatientRecord(ctx, {
      name: temporaryPatientName,
      phoneNumber: temporaryPatientPhoneNumber,
      practiceId,
    });
  }

  if (simulationKind && isSimulation !== true) {
    throw new Error(
      "simulationKind can only be used with simulated appointments.",
    );
  }

  // If a patientId is provided, verify it exists
  if (resolvedPatientId) {
    const patient = await ctx.db.get("patients", resolvedPatientId);
    if (!patient) {
      if (allowsMissingLinkedRecords) {
        resolvedPatientId = undefined;
      } else {
        throw new Error(`Patient with ID ${resolvedPatientId} not found`);
      }
    }
  }

  if (resolvedUserId) {
    const user = await ctx.db.get("users", resolvedUserId);
    if (!user) {
      if (allowsMissingLinkedRecords) {
        resolvedUserId = undefined;
      } else {
        throw new Error(`User with ID ${resolvedUserId} not found`);
      }
    }
  }

  // Look up the appointment type to get its name at booking time
  const appointmentType = await ctx.db.get(
    "appointmentTypes",
    appointmentTypeId,
  );
  const activeAppointmentType = requireEntityUsableForNewAppointment({
    entity: appointmentType,
    entityId: appointmentTypeId,
    entityLabel: "Terminart",
  });

  const location = await ctx.db.get("locations", locationId);
  requireEntityUsableForNewAppointment({
    entity: location,
    entityId: locationId,
    entityLabel: "Standort",
  });

  if (practitionerId) {
    const practitioner = await ctx.db.get("practitioners", practitionerId);
    requireEntityUsableForNewAppointment({
      entity: practitioner,
      entityId: practitionerId,
      entityLabel: "Behandler",
    });
  }

  const resolvedSimulationRuleSetId =
    isSimulation === true
      ? (simulationRuleSetId ?? activeAppointmentType.ruleSetId)
      : undefined;

  const storedReferences = await resolveStoredAppointmentReferencesForWrite(
    ctx.db,
    {
      appointmentTypeId: asAppointmentTypeId(appointmentTypeId),
      locationId: asLocationId(locationId),
      ...(practitionerId
        ? { practitionerId: asPractitionerId(practitionerId) }
        : {}),
    },
  );

  if (
    activeAppointmentType.followUpPlan &&
    activeAppointmentType.followUpPlan.length > 0
  ) {
    if (!practitionerId) {
      throw new Error(
        "Kettentermine benötigen einen ausgewählten Behandler für den Starttermin.",
      );
    }

    const result = await createAppointmentSeriesHelper(ctx, {
      locationId,
      ...(isNewPatient !== undefined && { isNewPatient }),
      ...(patientDateOfBirth && { patientDateOfBirth }),
      ...(resolvedPatientId && { patientId: resolvedPatientId }),
      practiceId,
      practitionerId,
      rootAppointmentTypeId: appointmentTypeId,
      ...(replacesAppointmentId && {
        rootReplacesAppointmentId: replacesAppointmentId,
      }),
      rootTitle: args.title.trim(),
      ruleSetId: activeAppointmentType.ruleSetId,
      scope: getAppointmentBookingScope(isSimulation),
      ...(resolvedSimulationRuleSetId && {
        simulationRuleSetId: resolvedSimulationRuleSetId,
      }),
      start: args.start,
      ...(resolvedUserId && { userId: resolvedUserId }),
    });

    return result.rootAppointmentId;
  }

  const end = calculateEndFromDuration(
    args.start,
    activeAppointmentType.duration,
  );

  const conflictingAppointment = await findConflictingAppointment(ctx.db, {
    candidate: {
      end,
      locationLineageKey: storedReferences.locationLineageKey,
      ...(storedReferences.practitionerLineageKey && {
        practitionerLineageKey: storedReferences.practitionerLineageKey,
      }),
      start: args.start,
    },
    practiceId,
    ...(resolvedSimulationRuleSetId
      ? { draftRuleSetId: resolvedSimulationRuleSetId }
      : {}),
    occupancyView: getOccupancyViewForBookingScope(
      getAppointmentBookingScope(isSimulation),
    ),
    ...(replacesAppointmentId && {
      excludeAppointmentIds: [replacesAppointmentId],
    }),
  });

  if (conflictingAppointment) {
    throw new Error("Der gewaehlte Zeitraum ist bereits belegt.");
  }

  const insertData = {
    ...rest,
    ...storedReferences,
    appointmentTypeTitle: activeAppointmentType.name,
    createdAt: now,
    end,
    isSimulation: isSimulation ?? false,
    lastModified: now,
    practiceId,
    ...(resolvedPatientId && { patientId: resolvedPatientId }),
    ...(resolvedUserId && { userId: resolvedUserId }),
    ...(replacesAppointmentId !== undefined && {
      replacesAppointmentId,
    }),
    ...(isSimulation === true && {
      simulationKind: simulationKind ?? "draft",
      ...(resolvedSimulationRuleSetId && {
        simulationRuleSetId: resolvedSimulationRuleSetId,
      }),
      simulationValidatedAt: now,
    }),
  };
  return await ctx.db.insert("appointments", insertData);
}

// Mutation to create a new appointment
export const createAppointment = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    isNewPatient: v.optional(v.boolean()),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientDateOfBirth: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    simulationKind: v.optional(appointmentSimulationKindValidator),
    simulationRuleSetId: v.optional(v.id("ruleSets")),
    start: v.string(),
    temporaryPatientName: v.optional(v.string()),
    temporaryPatientPhoneNumber: v.optional(v.string()),
    title: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    return await createAppointmentFromTrustedSource(ctx, args);
  },
  returns: v.id("appointments"),
});

function getAppointmentBookingScope(
  isSimulation: boolean | undefined,
): AppointmentBookingScope {
  return isSimulation === true ? "simulation" : "real";
}

const appointmentUpdateArgsValidator = {
  appointmentTypeId: v.optional(v.id("appointmentTypes")),
  end: v.optional(v.string()),
  id: v.id("appointments"),
  isSimulation: v.optional(v.boolean()),
  locationId: v.optional(v.id("locations")),
  patientId: v.optional(v.id("patients")),
  practitionerId: v.optional(v.id("practitioners")),
  replacesAppointmentId: v.optional(v.id("appointments")),
  simulationKind: v.optional(appointmentSimulationKindValidator),
  simulationRuleSetId: v.optional(v.id("ruleSets")),
  start: v.optional(v.string()),
  title: v.optional(v.string()),
  userId: v.optional(v.id("users")),
} as const;

interface AppointmentUpdateArgs {
  appointmentTypeId?: Id<"appointmentTypes">;
  end?: string;
  id: Id<"appointments">;
  isSimulation?: boolean;
  locationId?: Id<"locations">;
  patientId?: Id<"patients">;
  practitionerId?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  simulationKind?: AppointmentSimulationKind;
  simulationRuleSetId?: Id<"ruleSets">;
  start?: string;
  title?: string;
  userId?: Id<"users">;
}

type AppointmentUpdateMode = "activationReassignment" | "real" | "simulation";

function assertExpectedAppointmentUpdateMode(
  appointment: AppointmentDoc,
  expectedMode: AppointmentUpdateMode,
) {
  const actualMode = getExistingAppointmentUpdateMode(appointment);
  if (actualMode === expectedMode) {
    return;
  }

  switch (expectedMode) {
    case "real": {
      throw new Error(
        "Simulierte Termine können nicht über die Echttermin-Bearbeitung geändert werden.",
      );
    }
    case "simulation": {
      throw new Error(
        actualMode === "activationReassignment"
          ? "Urlaubsbedingte Vertretungsverschiebungen müssen separat bearbeitet werden."
          : "Echte Termine können nicht über die Simulations-Bearbeitung geändert werden.",
      );
    }
    case "activationReassignment": {
      throw new Error(
        "Nur urlaubsbedingte Vertretungsverschiebungen können über diese Bearbeitung geändert werden.",
      );
    }
  }
}

function assertImmutableAppointmentModeFields(
  updateData: Partial<AppointmentUpdateArgs>,
) {
  if (updateData.isSimulation !== undefined) {
    throw new Error(
      "Der Terminmodus kann nach dem Erstellen nicht geändert werden.",
    );
  }

  if (updateData.replacesAppointmentId !== undefined) {
    throw new Error(
      "Die Ersetzungsbeziehung eines Termins kann nach dem Erstellen nicht geändert werden.",
    );
  }

  if (updateData.simulationKind !== undefined) {
    throw new Error(
      "Die Art einer Simulation kann nach dem Erstellen nicht geändert werden.",
    );
  }

  if (updateData.simulationRuleSetId !== undefined) {
    throw new Error(
      "Das Simulations-Regelset eines Termins kann nach dem Erstellen nicht geändert werden.",
    );
  }
}

function getExistingAppointmentUpdateMode(
  appointment: AppointmentDoc,
): AppointmentUpdateMode {
  if (isActivationBoundSimulation(appointment)) {
    return "activationReassignment";
  }

  if (appointment.isSimulation === true) {
    return "simulation";
  }

  return "real";
}

function getPersistentSimulationFields(
  appointment: AppointmentDoc,
  now: bigint,
) {
  if (appointment.isSimulation !== true) {
    return {};
  }

  return {
    isSimulation: true,
    ...(appointment.reassignmentSourceVacationLineageKey && {
      reassignmentSourceVacationLineageKey:
        appointment.reassignmentSourceVacationLineageKey,
    }),
    simulationKind: appointment.simulationKind ?? ("draft" as const),
    ...(appointment.simulationRuleSetId && {
      simulationRuleSetId: appointment.simulationRuleSetId,
    }),
    simulationValidatedAt: now,
  };
}

async function updateAppointmentByMode(
  ctx: MutationCtx,
  args: AppointmentUpdateArgs,
  expectedMode: AppointmentUpdateMode,
) {
  const { id, ...updateData } = args;
  const existingAppointment = await ctx.db.get("appointments", id);
  if (!existingAppointment) {
    throw appointmentChainError("CHAIN_NOT_FOUND", "Appointment not found");
  }
  await ensurePracticeAccessForMutation(ctx, existingAppointment.practiceId);
  assertExpectedAppointmentUpdateMode(existingAppointment, expectedMode);

  // Filter out undefined values
  const filteredUpdateData = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    Object.entries(updateData).filter(([, value]) => value !== undefined),
  ) as Partial<typeof updateData>;
  assertImmutableAppointmentModeFields(filteredUpdateData);

  const { patientId, userId } = filteredUpdateData;

  if (patientId) {
    const patient = await ctx.db.get("patients", patientId);
    if (!patient) {
      throw new Error(`Patient with ID ${patientId} not found`);
    }
  }

  if (userId) {
    const user = await ctx.db.get("users", userId);
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
  }

  const appointmentTypeRecord =
    filteredUpdateData.appointmentTypeId === undefined
      ? undefined
      : await ctx.db.get(
          "appointmentTypes",
          filteredUpdateData.appointmentTypeId,
        );
  const locationRecord =
    filteredUpdateData.locationId === undefined
      ? undefined
      : await ctx.db.get("locations", filteredUpdateData.locationId);
  const practitionerRecord =
    filteredUpdateData.practitionerId === undefined
      ? undefined
      : await ctx.db.get("practitioners", filteredUpdateData.practitionerId);

  if (filteredUpdateData.appointmentTypeId !== undefined) {
    requireEntityUsableForNewAppointment({
      entity: appointmentTypeRecord,
      entityId: filteredUpdateData.appointmentTypeId,
      entityLabel: "Terminart",
    });
  }
  if (filteredUpdateData.locationId !== undefined) {
    requireEntityUsableForNewAppointment({
      entity: locationRecord,
      entityId: filteredUpdateData.locationId,
      entityLabel: "Standort",
    });
  }
  if (filteredUpdateData.practitionerId !== undefined) {
    requireEntityUsableForNewAppointment({
      entity: practitionerRecord,
      entityId: filteredUpdateData.practitionerId,
      entityLabel: "Behandler",
    });
  }

  const editingRuleSetId =
    appointmentTypeRecord?.ruleSetId ??
    practitionerRecord?.ruleSetId ??
    locationRecord?.ruleSetId;

  const resolvedStoredReferences =
    filteredUpdateData.appointmentTypeId !== undefined ||
    filteredUpdateData.locationId !== undefined ||
    filteredUpdateData.practitionerId !== undefined
      ? await (async () => {
          if (!editingRuleSetId) {
            throw new Error(
              "Das Regelset fuer die Terminbearbeitung konnte nicht bestimmt werden.",
            );
          }
          const appointmentTypeIdForWrite =
            filteredUpdateData.appointmentTypeId ??
            (await resolveAppointmentTypeIdForRuleSetByLineage(ctx.db, {
              lineageKey: asAppointmentTypeLineageKey(
                existingAppointment.appointmentTypeLineageKey,
              ),
              ruleSetId: editingRuleSetId,
            }));
          const locationIdForWrite =
            filteredUpdateData.locationId ??
            (await resolveLocationIdForRuleSetByLineage(ctx.db, {
              lineageKey: asLocationLineageKey(
                existingAppointment.locationLineageKey,
              ),
              ruleSetId: editingRuleSetId,
            }));
          const practitionerIdForWrite =
            filteredUpdateData.practitionerId ??
            (existingAppointment.practitionerLineageKey
              ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
                  lineageKey: asPractitionerLineageKey(
                    existingAppointment.practitionerLineageKey,
                  ),
                  ruleSetId: editingRuleSetId,
                })
              : undefined);

          return resolveStoredAppointmentReferencesForWrite(ctx.db, {
            appointmentTypeId: asAppointmentTypeId(appointmentTypeIdForWrite),
            locationId: asLocationId(locationIdForWrite),
            ...(practitionerIdForWrite
              ? { practitionerId: asPractitionerId(practitionerIdForWrite) }
              : {}),
          });
        })()
      : {
          appointmentTypeLineageKey:
            existingAppointment.appointmentTypeLineageKey,
          locationLineageKey: existingAppointment.locationLineageKey,
          ...(existingAppointment.practitionerLineageKey
            ? {
                practitionerLineageKey:
                  existingAppointment.practitionerLineageKey,
              }
            : {}),
        };
  const resolvedAppointmentTypeId =
    resolvedStoredReferences.appointmentTypeLineageKey;
  const resolvedLocationId = resolvedStoredReferences.locationLineageKey;
  const resolvedPractitionerId =
    resolvedStoredReferences.practitionerLineageKey;
  const resolvedStart = filteredUpdateData.start ?? existingAppointment.start;
  const resolvedEnd = filteredUpdateData.end ?? existingAppointment.end;
  const resolvedIsSimulation = existingAppointment.isSimulation;
  const resolvedSimulationRuleSetId = existingAppointment.simulationRuleSetId;

  if (
    filteredUpdateData.appointmentTypeId !== undefined ||
    filteredUpdateData.practitionerId !== undefined
  ) {
    const appointmentTypeRuleSetId =
      appointmentTypeRecord?.ruleSetId ?? practitionerRecord?.ruleSetId;

    if (!appointmentTypeRuleSetId) {
      throw new Error("Die Terminart konnte nicht validiert werden.");
    }

    const appointmentTypeIdForValidation =
      filteredUpdateData.appointmentTypeId ??
      (await resolveAppointmentTypeIdForRuleSetByLineage(ctx.db, {
        lineageKey: asAppointmentTypeLineageKey(
          existingAppointment.appointmentTypeLineageKey,
        ),
        ruleSetId: appointmentTypeRuleSetId,
      }));
    const appointmentType = await ctx.db.get(
      "appointmentTypes",
      appointmentTypeIdForValidation,
    );
    const activeAppointmentType = requireEntityUsableForNewAppointment({
      entity: appointmentType,
      entityId: appointmentTypeIdForValidation,
      entityLabel: "Terminart",
    });

    const practitionerIdForValidation =
      filteredUpdateData.practitionerId ??
      (existingAppointment.practitionerLineageKey
        ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
            lineageKey: asPractitionerLineageKey(
              existingAppointment.practitionerLineageKey,
            ),
            ruleSetId: activeAppointmentType.ruleSetId,
          })
        : undefined);

    if (
      practitionerIdForValidation &&
      !activeAppointmentType.allowedPractitionerIds.includes(
        practitionerIdForValidation,
      )
    ) {
      throw new Error(
        "Der gewählte Behandler ist für diese Terminart nicht freigegeben.",
      );
    }
  }

  const hasSchedulingChange =
    resolvedLocationId !== existingAppointment.locationLineageKey ||
    resolvedPractitionerId !== existingAppointment.practitionerLineageKey ||
    resolvedStart !== existingAppointment.start ||
    resolvedEnd !== existingAppointment.end;

  if (hasSchedulingChange) {
    const appointmentBookingScope =
      getAppointmentBookingScope(resolvedIsSimulation);
    const conflictingAppointment = await findConflictingAppointment(ctx.db, {
      candidate: {
        end: resolvedEnd,
        locationLineageKey: asLocationLineageKey(resolvedLocationId),
        ...(resolvedPractitionerId
          ? {
              practitionerLineageKey: asPractitionerLineageKey(
                resolvedPractitionerId,
              ),
            }
          : {}),
        start: resolvedStart,
      },
      excludeAppointmentIds: [existingAppointment._id],
      practiceId: existingAppointment.practiceId,
      ...(resolvedIsSimulation === true && resolvedSimulationRuleSetId
        ? { draftRuleSetId: resolvedSimulationRuleSetId }
        : {}),
      occupancyView: getOccupancyViewForBookingScope(appointmentBookingScope),
    });

    if (conflictingAppointment) {
      throw new Error("Der gewaehlte Zeitraum ist bereits belegt.");
    }
  }

  if (existingAppointment.seriesId !== undefined) {
    const seriesId = existingAppointment.seriesId;
    if (!seriesId) {
      throw appointmentChainError(
        "CHAIN_NOT_FOUND",
        "Appointment series metadata is incomplete.",
      );
    }

    if (existingAppointment.seriesStepIndex !== 0n) {
      throw appointmentChainError(
        "CHAIN_NON_ROOT_UPDATE_FORBIDDEN",
        "Folgetermine können nicht einzeln bearbeitet werden. Bitte den Starttermin bearbeiten.",
      );
    }

    if (filteredUpdateData.appointmentTypeId !== undefined) {
      const nextAppointmentTypeLineageKey =
        await resolveAppointmentTypeLineageKey(
          ctx.db,
          asAppointmentTypeId(filteredUpdateData.appointmentTypeId),
        );
      if (
        nextAppointmentTypeLineageKey !==
        existingAppointment.appointmentTypeLineageKey
      ) {
        throw appointmentChainError(
          "CHAIN_REPLAN_FAILED",
          "Die Terminart eines Kettentermins kann nach der Buchung nicht geändert werden.",
        );
      }
    }

    const seriesRecord = await getAppointmentSeriesRecord(ctx.db, seriesId);
    if (!seriesRecord) {
      throw appointmentChainError(
        "CHAIN_NOT_FOUND",
        "Die gespeicherte Kettentermin-Serie wurde nicht gefunden.",
      );
    }

    const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
    const seriesAppointmentIds = seriesAppointments.map(
      (appointment) => appointment._id,
    );
    const resolvedPatientId =
      filteredUpdateData.patientId ?? existingAppointment.patientId;
    const provisionalDateOfBirth = asOptionalIsoDateString(
      seriesRecord.patientDateOfBirth,
    );
    const resolvedPatientDateOfBirth =
      await resolvePreferredAppointmentPatientDateOfBirth(ctx.db, {
        ...(filteredUpdateData.patientId === undefined &&
          provisionalDateOfBirth !== undefined && {
            provisionalDateOfBirth,
          }),
        ...(resolvedPatientId && { patientId: resolvedPatientId }),
      });
    const updatedStart = asZonedDateTimeString(
      filteredUpdateData.start ?? existingAppointment.start,
    );
    let updatedEnd: ZonedDateTimeString;
    if (filteredUpdateData.end !== undefined) {
      updatedEnd = asZonedDateTimeString(filteredUpdateData.end);
    } else if (filteredUpdateData.start === undefined) {
      updatedEnd = asZonedDateTimeString(existingAppointment.end);
    } else {
      updatedEnd = calculateShiftedEnd(
        asZonedDateTimeString(existingAppointment.end),
        asZonedDateTimeString(existingAppointment.start),
        asZonedDateTimeString(filteredUpdateData.start),
      );
    }
    const practitionerId =
      filteredUpdateData.practitionerId ??
      (existingAppointment.practitionerLineageKey
        ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
            lineageKey: asPractitionerLineageKey(
              existingAppointment.practitionerLineageKey,
            ),
            ruleSetId: seriesRecord.ruleSetIdAtBooking,
          })
        : undefined);

    if (!practitionerId) {
      throw appointmentChainError(
        "CHAIN_REPLAN_FAILED",
        "Kettentermine benötigen einen Behandler auf dem Starttermin.",
      );
    }

    const plannedSteps = await replanAppointmentSeries(ctx, {
      excludedAppointmentIds: seriesAppointmentIds,
      locationId:
        filteredUpdateData.locationId ??
        (await resolveLocationIdForRuleSetByLineage(ctx.db, {
          lineageKey: asLocationLineageKey(
            existingAppointment.locationLineageKey,
          ),
          ruleSetId: seriesRecord.ruleSetIdAtBooking,
        })),
      ...(resolvedPatientDateOfBirth && {
        patientDateOfBirth: resolvedPatientDateOfBirth,
      }),
      ...(resolvedPatientId && { patientId: resolvedPatientId }),
      practiceId: existingAppointment.practiceId,
      practitionerId,
      rootDurationMinutes: calculateDurationMinutes(updatedEnd, updatedStart),
      scope: getAppointmentBookingScope(existingAppointment.isSimulation),
      series: seriesRecord,
      start: updatedStart,
      ...((filteredUpdateData.userId ?? existingAppointment.userId)
        ? { userId: filteredUpdateData.userId ?? existingAppointment.userId }
        : {}),
    });

    const now = BigInt(Date.now());
    const resolvedUserId =
      filteredUpdateData.userId ?? existingAppointment.userId;
    const existingByStepKey = new Map(
      seriesAppointments.map((appointment) => [
        getSeriesStepKey(appointment),
        appointment,
      ]),
    );
    const touchedAppointmentIds = new Set<Id<"appointments">>();
    const persistentSimulationFields = getPersistentSimulationFields(
      existingAppointment,
      now,
    );

    for (const step of plannedSteps) {
      const matchingAppointment = existingByStepKey.get(step.stepId);
      const title =
        step.seriesStepIndex === 0
          ? (filteredUpdateData.title?.trim() ?? existingAppointment.title)
          : `Folgetermin: ${step.appointmentTypeTitle}`;

      if (matchingAppointment) {
        const stepStoredReferences =
          await resolveStoredAppointmentReferencesForWrite(ctx.db, {
            appointmentTypeId: asAppointmentTypeId(step.appointmentTypeId),
            locationId: asLocationId(step.locationId),
            practitionerId: asPractitionerId(step.practitionerId),
          });
        await ctx.db.patch("appointments", matchingAppointment._id, {
          ...stepStoredReferences,
          ...persistentSimulationFields,
          appointmentTypeTitle: step.appointmentTypeTitle,
          end: step.end,
          lastModified: now,
          ...(resolvedPatientId && { patientId: resolvedPatientId }),
          seriesId,
          seriesStepId: step.stepId,
          seriesStepIndex: BigInt(step.seriesStepIndex),
          start: step.start,
          title,
          ...(resolvedUserId && { userId: resolvedUserId }),
        });
        touchedAppointmentIds.add(matchingAppointment._id);
        continue;
      }

      const stepStoredReferences =
        await resolveStoredAppointmentReferencesForWrite(ctx.db, {
          appointmentTypeId: asAppointmentTypeId(step.appointmentTypeId),
          locationId: asLocationId(step.locationId),
          practitionerId: asPractitionerId(step.practitionerId),
        });
      const insertedAppointmentId = await ctx.db.insert("appointments", {
        ...stepStoredReferences,
        ...persistentSimulationFields,
        appointmentTypeTitle: step.appointmentTypeTitle,
        createdAt: now,
        end: step.end,
        lastModified: now,
        ...(resolvedPatientId && { patientId: resolvedPatientId }),
        practiceId: existingAppointment.practiceId,
        seriesId,
        seriesStepId: step.stepId,
        seriesStepIndex: BigInt(step.seriesStepIndex),
        start: step.start,
        title,
        ...(resolvedUserId && { userId: resolvedUserId }),
      });
      touchedAppointmentIds.add(insertedAppointmentId);
    }

    for (const seriesAppointment of seriesAppointments) {
      if (!touchedAppointmentIds.has(seriesAppointment._id)) {
        await ctx.db.delete("appointments", seriesAppointment._id);
      }
    }

    await ctx.db.replace("appointmentSeries", seriesRecord._id, {
      createdAt: seriesRecord.createdAt,
      followUpPlanSnapshot: seriesRecord.followUpPlanSnapshot,
      lastModified: now,
      ...(resolvedPatientDateOfBirth && {
        patientDateOfBirth: resolvedPatientDateOfBirth,
      }),
      ...(resolvedPatientId && { patientId: resolvedPatientId }),
      practiceId: seriesRecord.practiceId,
      rootAppointmentId: id,
      rootAppointmentTypeId: seriesRecord.rootAppointmentTypeId,
      rootAppointmentTypeLineageKey: seriesRecord.rootAppointmentTypeLineageKey,
      rootDurationMinutes: calculateDurationMinutes(updatedEnd, updatedStart),
      ruleSetIdAtBooking: seriesRecord.ruleSetIdAtBooking,
      scope: seriesRecord.scope,
      seriesId: seriesRecord.seriesId,
      ...(resolvedUserId && { userId: resolvedUserId }),
    });

    return null;
  }

  const persistedUpdateData = Object.fromEntries(
    Object.entries(filteredUpdateData).filter(
      ([key]) =>
        key !== "appointmentTypeId" &&
        key !== "locationId" &&
        key !== "practitionerId",
    ),
  ) as Omit<
    typeof filteredUpdateData,
    "appointmentTypeId" | "locationId" | "practitionerId"
  >;

  await ctx.db.patch("appointments", id, {
    ...persistedUpdateData,
    ...getPersistentSimulationFields(existingAppointment, BigInt(Date.now())),
    appointmentTypeLineageKey: resolvedAppointmentTypeId,
    locationLineageKey: resolvedLocationId,
    ...(resolvedPractitionerId
      ? { practitionerLineageKey: resolvedPractitionerId }
      : filteredUpdateData.practitionerId === undefined
        ? {}
        : { practitionerLineageKey: undefined }),
    lastModified: BigInt(Date.now()),
  });

  return null;
}

// Mutation to update an existing real appointment
export const updateAppointment = mutation({
  args: appointmentUpdateArgsValidator,
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    return await updateAppointmentByMode(ctx, args, "real");
  },
  returns: v.null(),
});

export const updateSimulationAppointment = mutation({
  args: appointmentUpdateArgsValidator,
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    return await updateAppointmentByMode(ctx, args, "simulation");
  },
  returns: v.null(),
});

export const updateVacationReassignmentAppointment = mutation({
  args: appointmentUpdateArgsValidator,
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    return await updateAppointmentByMode(ctx, args, "activationReassignment");
  },
  returns: v.null(),
});

// Mutation to delete an appointment
export const deleteAppointment = mutation({
  args: {
    id: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const existingAppointment = await ctx.db.get("appointments", args.id);
    if (!existingAppointment) {
      throw appointmentChainError("CHAIN_NOT_FOUND", "Appointment not found");
    }
    await ensurePracticeAccessForMutation(ctx, existingAppointment.practiceId);

    if (existingAppointment.seriesId !== undefined) {
      const seriesId = existingAppointment.seriesId;
      if (!seriesId) {
        throw appointmentChainError(
          "CHAIN_NOT_FOUND",
          "Appointment series metadata is incomplete.",
        );
      }
      const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
      for (const seriesAppointment of seriesAppointments) {
        await ctx.db.delete("appointments", seriesAppointment._id);
      }
      const seriesRecord = await getAppointmentSeriesRecord(ctx.db, seriesId);
      if (seriesRecord) {
        await ctx.db.delete("appointmentSeries", seriesRecord._id);
      }
      return null;
    }

    await ctx.db.delete("appointments", args.id);
    return null;
  },
  returns: v.null(),
});

// Mutation for user self-service cancellation (soft-delete)
export const cancelOwnAppointment = mutation({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureAuthenticatedUserId(ctx);
    const appointment = await ctx.db.get("appointments", args.appointmentId);

    if (!appointment) {
      throw appointmentChainError("CHAIN_NOT_FOUND", "Appointment not found");
    }

    if (appointment.userId !== userId) {
      throw new Error("Access denied");
    }

    if (appointment.isSimulation === true) {
      throw new Error("Simulation appointments cannot be cancelled");
    }

    if (isAppointmentCancelled(appointment)) {
      return null;
    }

    const nowEpochMilliseconds = Temporal.Now.instant().epochMilliseconds;
    if (!isAppointmentInFuture(appointment, nowEpochMilliseconds)) {
      throw new Error("Only future appointments can be cancelled");
    }

    const now = BigInt(nowEpochMilliseconds);
    if (appointment.seriesId !== undefined) {
      const seriesId = appointment.seriesId;
      if (!seriesId) {
        throw appointmentChainError(
          "CHAIN_NOT_FOUND",
          "Appointment series metadata is incomplete.",
        );
      }
      const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
      for (const seriesAppointment of seriesAppointments) {
        if (
          seriesAppointment.userId !== userId ||
          seriesAppointment.isSimulation === true ||
          isAppointmentCancelled(seriesAppointment) ||
          !isAppointmentInFuture(seriesAppointment, nowEpochMilliseconds)
        ) {
          continue;
        }

        await ctx.db.patch("appointments", seriesAppointment._id, {
          cancelledAt: now,
          cancelledByUserId: userId,
          lastModified: now,
        });
      }
      return null;
    }

    await ctx.db.patch("appointments", args.appointmentId, {
      cancelledAt: now,
      cancelledByUserId: userId,
      lastModified: now,
    });

    return null;
  },
  returns: v.null(),
});

// Query to get the authenticated user's future booked appointments (future only)
export const getBookedAppointmentsForCurrentUser = query({
  args: {
    refreshNonce: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await getBookedAppointmentsForUser(ctx, args);
  },
  returns: v.array(appointmentResultValidator),
});

// Query to get the authenticated user's next booked appointment (future only)
export const getBookedAppointmentForCurrentUser = query({
  args: {
    refreshNonce: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const appointments = await getBookedAppointmentsForUser(ctx, args);
    return appointments[0] ?? null;
  },
  returns: v.union(appointmentResultValidator, v.null()),
});

async function getBookedAppointmentsForUser(
  ctx: QueryCtx,
  args: { refreshNonce?: number },
): Promise<AppointmentListItem[]> {
  const userId = await getAuthenticatedUserIdForQuery(ctx);
  if (!userId) {
    return [];
  }

  void args.refreshNonce;

  const nowInstant = Temporal.Now.instant();
  const nowEpochMilliseconds = nowInstant.epochMilliseconds;
  const nowStartLowerBound = nowInstant
    .toZonedDateTimeISO(APPOINTMENT_TIMEZONE)
    .toString();
  const appointmentQuery = ctx.db
    .query("appointments")
    .withIndex("by_userId_start", (q) =>
      q.eq("userId", userId).gte("start", nowStartLowerBound),
    );

  const appointments: AppointmentListItem[] = [];
  for await (const appointment of appointmentQuery) {
    if (
      appointment.isSimulation !== true &&
      isVisibleAppointment(appointment) &&
      isAppointmentInFuture(appointment, nowEpochMilliseconds)
    ) {
      appointments.push(toAppointmentListItem(appointment));
    }
  }

  return appointments;
}

// Query to get all appointments for a patient (past, present, and future)
export const getAppointmentsForPatient = query({
  args: {
    patientId: v.optional(v.id("patients")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    // Need at least one patient ID
    if (!args.patientId && !args.userId) {
      return [];
    }

    const appointments: AppointmentListItem[] = [];

    // Query by patient ID if provided
    if (args.patientId) {
      const patientAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
        .collect();
      appointments.push(
        ...patientAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        ),
      );
    }

    if (args.userId) {
      const userAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .collect();
      appointments.push(
        ...userAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        ),
      );
    }

    // Dedupe in case both queries return the same appointment, then sort by start time (ascending)
    const uniqueAppointments = [
      ...new Map(appointments.map((appt) => [appt._id, appt])).values(),
    ].filter((appointment) =>
      accessiblePracticeIds.has(appointment.practiceId),
    );

    return uniqueAppointments
      .filter((appointment) => isVisibleAppointment(appointment))
      .toSorted((a, b) => a.start.localeCompare(b.start));
  },
  returns: v.array(appointmentResultValidator),
});

// Internal mutation to delete all simulated appointments
export const deleteAllSimulatedAppointments = internalMutation({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    const practiceAppointments = await ctx.db
      .query("appointments")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const simulatedAppointments = practiceAppointments.filter(
      (appointment) => appointment.isSimulation === true,
    );

    for (const appointment of simulatedAppointments) {
      if (isActivationBoundSimulation(appointment)) {
        continue;
      }
      await ctx.db.delete("appointments", appointment._id);
    }

    return simulatedAppointments.filter(
      (appointment) => !isActivationBoundSimulation(appointment),
    ).length;
  },
  returns: v.number(),
});

// Query to get all blocked slots
export const getBlockedSlots = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const accessiblePracticeIds = new Set(
      await getAccessiblePracticeIdsForQuery(ctx),
    );
    const scope: AppointmentScope = args.scope ?? "real";

    let blockedSlots = await ctx.db
      .query("blockedSlots")
      .order("asc")
      .collect();
    blockedSlots = blockedSlots.filter((blockedSlot) =>
      accessiblePracticeIds.has(blockedSlot.practiceId),
    );

    let resultSlots: BlockedSlotDoc[];

    if (scope === "simulation") {
      resultSlots = combineBlockedSlotsForSimulation(blockedSlots);
    } else if (scope === "real") {
      resultSlots = blockedSlots.filter(
        (blockedSlot) => blockedSlot.isSimulation !== true,
      );
    } else {
      resultSlots = blockedSlots;
    }

    const displayRuleSetId = getDisplayRuleSetId(args);
    if (displayRuleSetId) {
      resultSlots = await remapBlockedSlotIds(
        ctx,
        resultSlots,
        displayRuleSetId,
      );
    }

    return resultSlots;
  },
  returns: v.array(blockedSlotListItemValidator),
});

export const getCalendarDayBlockedSlots = query({
  args: calendarDayQueryArgsValidator,
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);

    const scope: AppointmentScope = args.scope ?? "real";
    const selectedLocationLineageKey = await getOptionalLocationLineageKey(
      ctx.db,
      args.locationId,
    );
    const blockedSlots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_practiceId_start", (q) =>
        q.eq("practiceId", args.practiceId).gte("start", args.dayStart),
      )
      .collect();

    const blockedLocationLineageCache = new Map<
      Id<"locations">,
      Id<"locations"> | undefined
    >();
    const matchesLocation = async (blockedSlot: BlockedSlotDoc) => {
      if (selectedLocationLineageKey === undefined) {
        return true;
      }

      if (blockedLocationLineageCache.has(blockedSlot.locationId)) {
        const cachedLineageKey = blockedLocationLineageCache.get(
          blockedSlot.locationId,
        );
        return cachedLineageKey === selectedLocationLineageKey;
      }

      try {
        const lineageKey = await getOptionalLocationLineageKey(
          ctx.db,
          blockedSlot.locationId,
        );
        blockedLocationLineageCache.set(blockedSlot.locationId, lineageKey);
        return lineageKey === selectedLocationLineageKey;
      } catch {
        return false;
      }
    };

    const blockedSlotsWithVisibility = await Promise.all(
      blockedSlots.map(async (blockedSlot) =>
        isCalendarDayRangeMatch(args, blockedSlot.start) &&
        (await matchesLocation(blockedSlot))
          ? blockedSlot
          : null,
      ),
    );
    const visibleBlockedSlots = blockedSlotsWithVisibility.filter(
      (blockedSlot): blockedSlot is BlockedSlotDoc => blockedSlot !== null,
    );

    let resultSlots: BlockedSlotDoc[];
    if (scope === "simulation") {
      resultSlots = combineBlockedSlotsForSimulation(visibleBlockedSlots);
    } else if (scope === "real") {
      resultSlots = visibleBlockedSlots.filter(
        (blockedSlot) => blockedSlot.isSimulation !== true,
      );
    } else {
      resultSlots = visibleBlockedSlots;
    }

    const displayRuleSetId = getDisplayRuleSetId(args);
    if (displayRuleSetId) {
      resultSlots = await remapBlockedSlotIds(
        ctx,
        resultSlots,
        displayRuleSetId,
      );
    }

    return resultSlots.toSorted((left, right) =>
      left.start.localeCompare(right.start),
    );
  },
  returns: v.array(blockedSlotListItemValidator),
});

// Mutation to create a blocked slot
export const createBlockedSlot = mutation({
  args: {
    end: v.string(),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
    start: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const { isSimulation, replacesBlockedSlotId, ...rest } = args;

    if (replacesBlockedSlotId && isSimulation !== true) {
      throw new Error(
        "replacesBlockedSlotId can only be used with isSimulation=true",
      );
    }

    const id = await ctx.db.insert("blockedSlots", {
      ...rest,
      createdAt: BigInt(Date.now()),
      isSimulation: isSimulation ?? false,
      lastModified: BigInt(Date.now()),
      ...(replacesBlockedSlotId && { replacesBlockedSlotId }),
    });

    return id;
  },
  returns: v.id("blockedSlots"),
});

// Mutation to update a blocked slot
export const updateBlockedSlot = mutation({
  args: {
    end: v.optional(v.string()),
    id: v.id("blockedSlots"),
    isSimulation: v.optional(v.boolean()),
    locationId: v.optional(v.id("locations")),
    practitionerId: v.optional(v.id("practitioners")),
    replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
    start: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const { id, ...updates } = args;
    const existingBlockedSlot = await ctx.db.get("blockedSlots", id);
    if (!existingBlockedSlot) {
      throw new Error("Blocked slot not found");
    }
    await ensurePracticeAccessForMutation(ctx, existingBlockedSlot.practiceId);

    await ctx.db.patch("blockedSlots", id, {
      ...updates,
      lastModified: BigInt(Date.now()),
    });

    return null;
  },
  returns: v.null(),
});

// Mutation to delete a blocked slot
export const deleteBlockedSlot = mutation({
  args: {
    id: v.id("blockedSlots"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const existingBlockedSlot = await ctx.db.get("blockedSlots", args.id);
    if (!existingBlockedSlot) {
      throw new Error("Blocked slot not found");
    }
    await ensurePracticeAccessForMutation(ctx, existingBlockedSlot.practiceId);
    await ctx.db.delete("blockedSlots", args.id);
    return null;
  },
  returns: v.null(),
});

// Internal mutation to delete all simulated blocked slots
export const deleteAllSimulatedBlockedSlots = internalMutation({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    const practiceBlockedSlots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const simulatedBlockedSlots = practiceBlockedSlots.filter(
      (blockedSlot) => blockedSlot.isSimulation === true,
    );

    for (const blockedSlot of simulatedBlockedSlots) {
      await ctx.db.delete("blockedSlots", blockedSlot._id);
    }

    return simulatedBlockedSlots.length;
  },
  returns: v.number(),
});

// Combined mutation to delete all simulated appointments and blocked slots
export const deleteAllSimulatedData = mutation({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    appointmentsDeleted: number;
    blockedSlotsDeleted: number;
    total: number;
  }> => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const appointmentsDeleted: number = await ctx.runMutation(
      internal.appointments.deleteAllSimulatedAppointments,
      { practiceId: args.practiceId },
    );
    const blockedSlotsDeleted: number = await ctx.runMutation(
      internal.appointments.deleteAllSimulatedBlockedSlots,
      { practiceId: args.practiceId },
    );

    return {
      appointmentsDeleted,
      blockedSlotsDeleted,
      total: appointmentsDeleted + blockedSlotsDeleted,
    };
  },
  returns: v.object({
    appointmentsDeleted: v.number(),
    blockedSlotsDeleted: v.number(),
    total: v.number(),
  }),
});
