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

import { mutation, query } from "./_generated/server";
import {
  DEFAULT_APPOINTMENT_COLOR,
  resolveAppointmentColorForType,
} from "./appointmentColors";
import {
  type AppointmentBookingScope,
  appointmentOverlapsCandidate,
  findConflictingCalendarOccupancy,
  getOccupancyViewForBookingScope,
} from "./appointmentConflicts";
import {
  appointmentOccupancyScopeFromRefs,
  appointmentOccupancyScopeValidator,
  blockedSlotOccupancyScopeValidator,
  type CalendarResourceColumn,
  calendarResourceColumnValidator,
  getAppointmentCalendarResourceColumn,
  getAppointmentPractitionerLineageKey,
  getBlockedSlotPractitionerLineageKey,
} from "./appointmentOccupancy";
import {
  hasAppointmentPlan,
  normalizeDefaultOccupancy,
} from "./appointmentPlans";
import {
  resolveAppointmentTypeIdForRuleSetByLineage,
  resolveAppointmentTypeLineageKey,
  resolveLocationIdForRuleSetByLineage,
  resolveLocationLineageKey,
  resolvePractitionerIdForRuleSetByLineage,
  resolveStoredAppointmentReferencesForWrite,
  type StoredAppointmentReferences,
} from "./appointmentReferences";
import {
  appointmentSeriesArgsValidator,
  appointmentSeriesCreateResultValidator,
  appointmentSeriesPreviewResultValidator,
  createAppointmentSeries as createAppointmentSeriesHelper,
  createSeriesPlanningState,
  hasResourceRootSchedulerAvailability,
  previewAppointmentSeries as previewAppointmentSeriesHelper,
  replanAppointmentSeries,
  type SeriesRootOccupancy,
} from "./appointmentSeries";
import { appointmentSeriesRestoreSnapshotValidator } from "./appointmentSeriesRestoreSnapshots";
import {
  appointmentReplacementInsertFields,
  appointmentReplacementState,
  appointmentReplacementStatesEqual,
  type AppointmentSimulationKind,
  appointmentSimulationKindValidator,
  isActivationBoundSimulation,
} from "./appointmentSimulation";
import {
  type AppointmentTypeLineageKey,
  asAppointmentTypeId,
  asAppointmentTypeLineageKey,
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
  type LocationLineageKey,
  type PractitionerLineageKey,
} from "./identity";
import {
  getFutureLegacyUnmatchedBookingHoldsForUser,
  type LegacyUnmatchedFutureBookingHoldScope,
  legacyUnmatchedFutureBookingHoldSummaryValidator,
  toLegacyUnmatchedFutureBookingHoldSummary,
} from "./legacyUnmatchedFutureBookingHolds";
import { requireLineageKey } from "./lineage";
import {
  requirePracticeManagerForMutation,
  requirePracticeStaff,
  requirePracticeStaffForMutation,
  requireRuleSetBelongsToPractice,
  requireTrustedPracticeScope,
  requireTrustedRuleSetScope,
  type TrustedPracticeScope,
} from "./practiceAccess";
import {
  type AppointmentContext,
  buildPreloadedDayData,
  evaluateLoadedRulesHelper,
} from "./ruleEngine";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import {
  type AppointmentColor,
  appointmentColorValidator,
  type AppointmentSmiley,
  appointmentSmileyValidator,
} from "./schema";
import {
  requireAppointmentTypeInPracticeRuleSet,
  requireBookingIdentityInPractice,
  requireLocationInPractice,
  requireLocationInPracticeRuleSet,
  requirePatientInPractice,
  requirePhoneBookingIdentityInPractice,
  requirePractitionerInPractice,
  requirePractitionerInPracticeRuleSet,
  userHasPracticeRelation,
} from "./scopedResources";
import { createTemporaryPatientRecordWithIdentity } from "./temporaryPatients";
import {
  asInstantString,
  asIsoDateString,
  asOptionalIsoDateString,
  asTypedDateTimeRange,
  asZonedDateTimeString,
} from "./typedDtos";
import {
  ensureAuthenticatedIdentity,
  ensureAuthenticatedUserId,
  requireAuthenticatedUserIdForQuery,
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
type AppointmentListItemDocBackedOptionalKey = Extract<
  OptionalKeys<AppointmentListItem>,
  keyof AppointmentDoc
>;
type AppointmentScope = "all" | "real" | "simulation";
type AppointmentSeriesDoc = Doc<"appointmentSeries">;
type BlockedSlotDoc = Doc<"blockedSlots">;
type BlockedSlotListItem = Infer<typeof blockedSlotListItemValidator>;

type BlockedSlotListItemDocBackedOptionalKey = Extract<
  OptionalKeys<BlockedSlotListItem>,
  keyof BlockedSlotDoc
>;
type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never;
}[keyof T];
const APPOINTMENT_TIMEZONE = "Europe/Berlin";
const STAFF_PLANNER_CLIENT_TYPE = "MFA";

const appointmentSeriesRestoreResultValidator = v.object({
  appointments: v.array(
    v.object({
      appointmentId: v.id("appointments"),
      originalAppointmentId: v.id("appointments"),
    }),
  ),
  rootAppointmentId: v.id("appointments"),
  seriesId: v.string(),
});

type AppointmentOwner = LinkedAppointmentOwner | TemporaryAppointmentOwner;

interface AppointmentOwnerInput {
  bookingIdentityId?: Id<"bookingIdentities">;
  patientId?: Id<"patients">;
  phoneBookingIdentityId?: Id<"phoneBookingIdentities">;
  temporaryPatientName?: string;
  temporaryPatientPhoneNumber?: string;
  userId?: Id<"users">;
}

interface LinkedAppointmentOwner {
  bookingIdentityId?: Id<"bookingIdentities">;
  kind: "linked";
  patientId?: Id<"patients">;
  phoneBookingIdentityId?: Id<"phoneBookingIdentities">;
  userId?: Id<"users">;
}

interface ResolvedAppointmentOwnerRefs {
  bookingIdentityId?: Id<"bookingIdentities">;
  patientId?: Id<"patients">;
  phoneBookingIdentityId?: Id<"phoneBookingIdentities">;
  userId?: Id<"users">;
}

interface TemporaryAppointmentOwner {
  kind: "temporary";
  name: string;
  phoneNumber: string;
}

interface TrustedAppointmentInput {
  allowHistoricalSmiley?: boolean;
  allowRestoredEnd?: boolean;
  allowUnrelatedUserId?: boolean;
  appointmentTypeId: Id<"appointmentTypes">;
  bookingIdentityId?: Id<"bookingIdentities">;
  calendarResourceColumn?: "ekg" | "labor";
  color?: AppointmentColor;
  end?: ZonedDateTimeString;
  isNewPatient?: boolean;
  isSimulation?: boolean;
  locationId: Id<"locations">;
  patientDateOfBirth?: IsoDateString;
  patientId?: Id<"patients">;
  phoneBookingIdentityId?: Id<"phoneBookingIdentities">;
  practiceId: Id<"practices">;
  practitionerId?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  simulationKind?: AppointmentSimulationKind;
  simulationRuleSetId?: Id<"ruleSets">;
  smiley?: AppointmentSmiley;
  start: ZonedDateTimeString;
  temporaryPatientName?: string;
  temporaryPatientPhoneNumber?: string;
  title: string;
  userId?: Id<"users">;
}

function resolveSingleAppointmentOccupancy(args: {
  appointmentType: Doc<"appointmentTypes">;
  calendarResourceColumn?: CalendarResourceColumn;
  storedReferences: StoredAppointmentReferences;
}) {
  const defaultOccupancy = normalizeDefaultOccupancy(
    args.appointmentType.defaultOccupancy,
  );

  if (defaultOccupancy.kind === "resourceColumn") {
    const calendarResourceColumn =
      args.calendarResourceColumn ?? defaultOccupancy.calendarResourceColumn;
    if (calendarResourceColumn !== defaultOccupancy.calendarResourceColumn) {
      throw new Error(
        "Der Termin muss in der Standard-Ressourcenspalte der Terminart liegen.",
      );
    }
    return appointmentOccupancyScopeFromRefs({ calendarResourceColumn });
  }

  if (args.calendarResourceColumn !== undefined) {
    return appointmentOccupancyScopeFromRefs({
      calendarResourceColumn: args.calendarResourceColumn,
    });
  }

  return appointmentOccupancyScopeFromRefs({
    practitionerLineageKey: args.storedReferences.practitionerLineageKey,
  });
}

const appointmentResultValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("appointments"),
  appointmentTypeId: v.id("appointmentTypes"),
  appointmentTypeLineageKey: v.id("appointmentTypes"),
  appointmentTypeTitle: v.string(),
  bookingIdentityId: v.optional(v.id("bookingIdentities")),
  cancelledByPhoneBookingIdentityId: v.optional(v.id("phoneBookingIdentities")),
  color: appointmentColorValidator,
  createdAt: v.int64(),
  end: v.string(),
  isSimulation: v.optional(v.boolean()),
  lastModified: v.int64(),
  locationId: v.id("locations"),
  locationLineageKey: v.id("locations"),
  occupancyScope: appointmentOccupancyScopeValidator,
  patientId: v.optional(v.id("patients")),
  phoneBookingIdentityId: v.optional(v.id("phoneBookingIdentities")),
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
  smiley: v.optional(appointmentSmileyValidator),
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
  locationLineageKey: v.id("locations"),
  occupancyScope: blockedSlotOccupancyScopeValidator,
  practiceId: v.id("practices"),
  practitionerId: v.optional(v.id("practitioners")),
  replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
  start: v.string(),
  title: v.string(),
});

const blockedSlotMutationOccupancyScopeValidator = v.union(
  v.object({
    kind: v.literal("practitioner"),
    practitionerId: v.id("practitioners"),
  }),
  v.object({
    calendarResourceColumn: calendarResourceColumnValidator,
    kind: v.literal("resource"),
  }),
);

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
export type { AppointmentSmiley } from "./schema";
export type BlockedSlotResult = BlockedSlotListItem;

const {
  smiley: _bookedAppointmentSummarySmileyField,
  ...bookedAppointmentSummaryFields
} = appointmentResultValidator.fields;
void _bookedAppointmentSummarySmileyField;

const bookedAppointmentSummaryItemValidator = v.union(
  v.object({
    ...bookedAppointmentSummaryFields,
    kind: v.literal("appointment"),
  }),
  legacyUnmatchedFutureBookingHoldSummaryValidator,
);

export type BookedAppointmentSummaryItem = Infer<
  typeof bookedAppointmentSummaryItemValidator
>;

export const appointmentListItemDocBackedOptionalFieldCoverage = {
  bookingIdentityId: true,
  cancelledAt: true,
  cancelledByPhoneBookingIdentityId: true,
  isSimulation: true,
  patientId: true,
  phoneBookingIdentityId: true,
  reassignmentSourceVacationLineageKey: true,
  replacesAppointmentId: true,
  seriesId: true,
  seriesStepId: true,
  seriesStepIndex: true,
  simulationKind: true,
  simulationRuleSetId: true,
  simulationValidatedAt: true,
  smiley: true,
  userId: true,
} satisfies Record<AppointmentListItemDocBackedOptionalKey, true>;

export const blockedSlotListItemDocBackedOptionalFieldCoverage = {
  isSimulation: true,
  replacesBlockedSlotId: true,
} satisfies Record<BlockedSlotListItemDocBackedOptionalKey, true>;

function appointmentChainError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function asTrustedAppointmentInput(args: {
  allowHistoricalSmiley?: boolean;
  allowRestoredEnd?: boolean;
  allowUnrelatedUserId?: boolean;
  appointmentTypeId: Id<"appointmentTypes">;
  bookingIdentityId?: Id<"bookingIdentities">;
  calendarResourceColumn?: "ekg" | "labor";
  color?: AppointmentColor;
  end?: string;
  isNewPatient?: boolean;
  isSimulation?: boolean;
  locationId: Id<"locations">;
  patientDateOfBirth?: string;
  patientId?: Id<"patients">;
  phoneBookingIdentityId?: Id<"phoneBookingIdentities">;
  practiceId: Id<"practices">;
  practitionerId?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  simulationKind?: AppointmentSimulationKind;
  simulationRuleSetId?: Id<"ruleSets">;
  smiley?: AppointmentSmiley;
  start: string;
  temporaryPatientName?: string;
  temporaryPatientPhoneNumber?: string;
  title: string;
  userId?: Id<"users">;
}): TrustedAppointmentInput {
  const {
    end: rawEnd,
    patientDateOfBirth: rawPatientDateOfBirth,
    start,
    ...rest
  } = args;
  const patientDateOfBirth = asOptionalIsoDateString(rawPatientDateOfBirth);
  return {
    ...rest,
    ...(rawEnd !== undefined && { end: asZonedDateTimeString(rawEnd) }),
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

function filterCurrentAppointmentReplacementTails<T extends AppointmentDoc>(
  appointments: T[],
): T[] {
  const appointmentsById = new Map(
    appointments.map((appointment) => [appointment._id, appointment] as const),
  );
  const hiddenIds = new Set<Id<"appointments">>();

  for (const appointment of appointments) {
    const replacementRoot = findReplacementRoot(appointment, appointmentsById);
    if (replacementRoot?.cancelledAt !== undefined) {
      hiddenIds.add(appointment._id);
      continue;
    }

    if (!isVisibleAppointment(appointment)) {
      continue;
    }

    const replacedAppointmentId = appointment.replacesAppointmentId;
    if (!replacedAppointmentId) {
      continue;
    }
    const replacedAppointment = appointmentsById.get(replacedAppointmentId);
    if (
      replacedAppointment &&
      isSameAppointmentReplacementPractice(appointment, replacedAppointment) &&
      isSameAppointmentReplacementDay(appointment, replacedAppointment)
    ) {
      hiddenIds.add(replacedAppointmentId);
    }
  }

  return appointments.filter(
    (appointment) =>
      isVisibleAppointment(appointment) && !hiddenIds.has(appointment._id),
  );
}

async function findPlannerBlockingRuleIdsForAppointmentWrite(
  db: DatabaseReader,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationId: Id<"locations">;
    patientDateOfBirth?: IsoDateString;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    ruleSetId: Id<"ruleSets">;
    start: ZonedDateTimeString;
  },
): Promise<Id<"ruleConditions">[]> {
  const rules = await db
    .query("ruleConditions")
    .withIndex("by_ruleSetId_isRoot", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("isRoot", true),
    )
    .collect();
  if (rules.length === 0) {
    return [];
  }

  const conditions = await db
    .query("ruleConditions")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
    .collect();
  const conditionsMap = new Map<Id<"ruleConditions">, Doc<"ruleConditions">>(
    conditions.map((condition) => [condition._id, condition]),
  );
  const practitioners = await db
    .query("practitioners")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
    .collect();
  const appointmentDate = Temporal.ZonedDateTime.from(args.start)
    .toPlainDate()
    .toString();
  const preloadedData = await buildPreloadedDayData(
    db,
    args.practiceId,
    appointmentDate,
    args.ruleSetId,
    practitioners,
  );
  const appointmentContext: AppointmentContext = {
    appointmentTypeId: args.appointmentTypeId,
    clientType: STAFF_PLANNER_CLIENT_TYPE,
    dateTime: args.start,
    locationId: args.locationId,
    ...(args.patientDateOfBirth === undefined
      ? {}
      : { patientDateOfBirth: args.patientDateOfBirth }),
    practiceId: args.practiceId,
    ...(args.practitionerId === undefined
      ? {}
      : { practitionerId: args.practitionerId }),
    requestedAt: asZonedDateTimeString(
      Temporal.Now.zonedDateTimeISO(APPOINTMENT_TIMEZONE).toString(),
    ),
  };

  const result = evaluateLoadedRulesHelper(
    appointmentContext,
    {
      conditions,
      conditionsMap,
      rules: rules.map((rule) => ({ _id: rule._id, isDayInvariant: false })),
    },
    preloadedData,
  );
  return result.blockedByRuleIds;
}

function findReplacementRoot<T extends AppointmentDoc>(
  appointment: T,
  appointmentsById: ReadonlyMap<Id<"appointments">, T>,
): T | undefined {
  let current: T | undefined = appointment;
  const visitedIds = new Set<Id<"appointments">>();

  while (current.replacesAppointmentId) {
    if (visitedIds.has(current._id)) {
      return current;
    }
    visitedIds.add(current._id);
    const previous = appointmentsById.get(current.replacesAppointmentId);
    if (
      !previous ||
      !isSameAppointmentReplacementPractice(current, previous) ||
      !isSameAppointmentReplacementDay(current, previous)
    ) {
      return current;
    }
    current = previous;
  }

  return current;
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

async function getConfiguredAppointmentSmileyOptions(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    ruleSetId?: Id<"ruleSets">;
  },
) {
  if (args.ruleSetId !== undefined) {
    const ruleSet = await db.get("ruleSets", args.ruleSetId);
    if (ruleSet?.practiceId !== args.practiceId) {
      throw new Error("Rule set does not belong to this practice");
    }
    return ruleSet.appointmentSmileyOptions ?? [];
  }

  const practice = await db.get("practices", args.practiceId);
  return practice?.appointmentSmileyOptions ?? [];
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

function isSameAppointmentReplacementDay(
  replacement: Pick<AppointmentDoc, "start">,
  replaced: Pick<AppointmentDoc, "start">,
): boolean {
  return (
    Temporal.ZonedDateTime.from(replacement.start).toPlainDate().toString() ===
    Temporal.ZonedDateTime.from(replaced.start).toPlainDate().toString()
  );
}

function isSameAppointmentReplacementPractice(
  replacement: Pick<AppointmentDoc, "practiceId">,
  replaced: Pick<AppointmentDoc, "practiceId">,
): boolean {
  return replacement.practiceId === replaced.practiceId;
}

function isVisibleAppointment(
  appointment: Pick<AppointmentDoc, "cancelledAt">,
): boolean {
  return !isAppointmentCancelled(appointment);
}

async function mapBlockedSlotForDisplay(
  db: DatabaseReader,
  blockedSlot: BlockedSlotDoc,
  targetRuleSetId?: Id<"ruleSets">,
): Promise<BlockedSlotListItem | null> {
  try {
    const practitionerLineageKey = getBlockedSlotPractitionerLineageKey(
      blockedSlot.occupancyScope,
    );
    return {
      _creationTime: blockedSlot._creationTime,
      _id: blockedSlot._id,
      createdAt: blockedSlot.createdAt,
      end: blockedSlot.end,
      ...(blockedSlot.isSimulation === undefined
        ? {}
        : { isSimulation: blockedSlot.isSimulation }),
      lastModified: blockedSlot.lastModified,
      locationId:
        targetRuleSetId === undefined
          ? blockedSlot.locationLineageKey
          : await resolveLocationIdForDisplayRuleSet(
              db,
              asLocationLineageKey(blockedSlot.locationLineageKey),
              targetRuleSetId,
            ),
      locationLineageKey: blockedSlot.locationLineageKey,
      occupancyScope: blockedSlot.occupancyScope,
      practiceId: blockedSlot.practiceId,
      ...(practitionerLineageKey
        ? {
            practitionerId:
              targetRuleSetId === undefined
                ? practitionerLineageKey
                : await resolvePractitionerIdForDisplayRuleSet(
                    db,
                    asPractitionerLineageKey(practitionerLineageKey),
                    targetRuleSetId,
                  ),
          }
        : {}),
      ...(blockedSlot.replacesBlockedSlotId === undefined
        ? {}
        : { replacesBlockedSlotId: blockedSlot.replacesBlockedSlotId }),
      start: blockedSlot.start,
      title: blockedSlot.title,
    };
  } catch (error) {
    if (isMissingDisplayLineageMappingError(error)) {
      return null;
    }
    throw error;
  }
}

async function mapBlockedSlotsForDisplay(
  db: DatabaseReader,
  blockedSlots: BlockedSlotDoc[],
  targetRuleSetId?: Id<"ruleSets">,
): Promise<BlockedSlotListItem[]> {
  const mappedSlots = await Promise.all(
    blockedSlots.map((slot) =>
      mapBlockedSlotForDisplay(db, slot, targetRuleSetId),
    ),
  );

  return mappedSlots.filter(
    (slot): slot is BlockedSlotListItem => slot !== null,
  );
}

function parseAppointmentOwner(args: AppointmentOwnerInput): AppointmentOwner {
  const hasLinkedOwner =
    args.bookingIdentityId !== undefined ||
    args.patientId !== undefined ||
    args.phoneBookingIdentityId !== undefined ||
    args.userId !== undefined;
  const temporaryPatientName = args.temporaryPatientName;
  const temporaryPatientPhoneNumber = args.temporaryPatientPhoneNumber;
  const hasTemporaryOwner =
    temporaryPatientName !== undefined ||
    temporaryPatientPhoneNumber !== undefined;

  if (hasLinkedOwner && hasTemporaryOwner) {
    throw new Error(
      "Temporäre Patientendaten können nicht zusammen mit patientId, userId, bookingIdentityId oder phoneBookingIdentityId übergeben werden.",
    );
  }

  if (hasLinkedOwner) {
    return {
      ...(args.bookingIdentityId !== undefined && {
        bookingIdentityId: args.bookingIdentityId,
      }),
      kind: "linked",
      ...(args.patientId !== undefined && { patientId: args.patientId }),
      ...(args.phoneBookingIdentityId !== undefined && {
        phoneBookingIdentityId: args.phoneBookingIdentityId,
      }),
      ...(args.userId !== undefined && { userId: args.userId }),
    };
  }

  if (
    temporaryPatientName === undefined ||
    temporaryPatientPhoneNumber === undefined
  ) {
    throw new Error(
      "Either patientId, userId, or temporary patient data must be provided.",
    );
  }

  return {
    kind: "temporary",
    name: temporaryPatientName,
    phoneNumber: temporaryPatientPhoneNumber,
  };
}

async function requireConfiguredAppointmentSmiley(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    ruleSetId?: Id<"ruleSets">;
    smiley: AppointmentSmiley;
  },
) {
  const options = await getConfiguredAppointmentSmileyOptions(db, args);
  if (!options.some((option) => option.emoji === args.smiley)) {
    throw new Error(
      "Der gewählte Termin-Smiley ist für diese Praxis nicht konfiguriert.",
    );
  }
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

async function requireKnownAppointmentSmiley(
  db: DatabaseReader,
  args: {
    practiceId: Id<"practices">;
    smiley: AppointmentSmiley;
  },
) {
  const practice = await db.get("practices", args.practiceId);
  const activeOptions = practice?.appointmentSmileyOptions ?? [];
  if (activeOptions.some((option) => option.emoji === args.smiley)) {
    return;
  }

  const ruleSets = await db
    .query("ruleSets")
    .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
    .collect();
  if (
    ruleSets.some((ruleSet) =>
      (ruleSet.appointmentSmileyOptions ?? []).some(
        (option) => option.emoji === args.smiley,
      ),
    )
  ) {
    return;
  }

  throw new Error(
    "Der gewählte Termin-Smiley ist in dieser Praxis nicht bekannt.",
  );
}

async function requireManagerForPlannerRuleOverride(
  ctx: MutationCtx,
  args: {
    appointmentTypeId: Id<"appointmentTypes">;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    start: string;
  },
): Promise<void> {
  const appointmentType = await ctx.db.get(
    "appointmentTypes",
    args.appointmentTypeId,
  );
  if (!appointmentType) {
    return;
  }

  const blockingRuleIds = await findPlannerBlockingRuleIdsForAppointmentWrite(
    ctx.db,
    {
      appointmentTypeId: args.appointmentTypeId,
      locationId: args.locationId,
      ...(args.patientDateOfBirth === undefined
        ? {}
        : { patientDateOfBirth: asIsoDateString(args.patientDateOfBirth) }),
      practiceId: args.practiceId,
      ...(args.practitionerId === undefined
        ? {}
        : { practitionerId: args.practitionerId }),
      ruleSetId: appointmentType.ruleSetId,
      start: asZonedDateTimeString(args.start),
    },
  );
  if (blockingRuleIds.length > 0) {
    await requirePracticeManagerForMutation(ctx, args.practiceId);
  }
}

async function resolveAppointmentTypeForDisplayRuleSet(
  db: DatabaseReader,
  appointmentTypeLineageKey: AppointmentTypeLineageKey,
  targetRuleSetId: Id<"ruleSets">,
): Promise<{
  appointmentTypeId: Id<"appointmentTypes">;
  appointmentTypeTitle: string;
}> {
  const appointmentTypeId = await resolveAppointmentTypeIdForDisplayRuleSet(
    db,
    appointmentTypeLineageKey,
    targetRuleSetId,
  );
  const appointmentType = await db.get("appointmentTypes", appointmentTypeId);
  if (!appointmentType) {
    throw new Error(
      `Terminart ${appointmentTypeLineageKey} konnte im Regelset ${targetRuleSetId} nicht geladen werden.`,
    );
  }
  return {
    appointmentTypeId,
    appointmentTypeTitle: appointmentType.name,
  };
}

async function resolveAppointmentTypeIdForDisplayRuleSet(
  db: DatabaseReader,
  appointmentTypeLineageKey: AppointmentTypeLineageKey,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"appointmentTypes">> {
  return await resolveAppointmentTypeIdForRuleSetByLineage(db, {
    lineageKey: appointmentTypeLineageKey,
    ruleSetId: targetRuleSetId,
  });
}

async function resolveLocationIdForDisplayRuleSet(
  db: DatabaseReader,
  locationLineageKey: LocationLineageKey,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"locations">> {
  return await resolveLocationIdForRuleSetByLineage(db, {
    lineageKey: locationLineageKey,
    ruleSetId: targetRuleSetId,
  });
}

async function resolvePractitionerIdForDisplayRuleSet(
  db: DatabaseReader,
  practitionerLineageKey: PractitionerLineageKey,
  targetRuleSetId: Id<"ruleSets">,
): Promise<Id<"practitioners">> {
  return await resolvePractitionerIdForRuleSetByLineage(db, {
    lineageKey: practitionerLineageKey,
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

async function saveAppointmentRestoreSnapshot(
  ctx: MutationCtx,
  appointment: AppointmentDoc,
  deletedAt: bigint,
) {
  const practice = await ctx.db.get("practices", appointment.practiceId);
  const restoreRuleSetId =
    appointment.simulationRuleSetId ?? practice?.currentActiveRuleSetId;
  if (!restoreRuleSetId) {
    return;
  }

  const appointmentTypeId =
    await tryResolveAppointmentTypeIdForRuleSetByLineage(ctx.db, {
      lineageKey: asAppointmentTypeLineageKey(
        appointment.appointmentTypeLineageKey,
      ),
      ruleSetId: restoreRuleSetId,
    });
  const locationId = await tryResolveLocationIdForRuleSetByLineage(ctx.db, {
    lineageKey: asLocationLineageKey(appointment.locationLineageKey),
    ruleSetId: restoreRuleSetId,
  });
  const practitionerLineageKey = getAppointmentPractitionerLineageKey(
    appointment.occupancyScope,
  );
  const practitionerId =
    practitionerLineageKey === undefined
      ? undefined
      : await tryResolvePractitionerIdForRuleSetByLineage(ctx.db, {
          lineageKey: asPractitionerLineageKey(practitionerLineageKey),
          ruleSetId: restoreRuleSetId,
        });
  if (
    appointmentTypeId === undefined ||
    locationId === undefined ||
    (practitionerLineageKey !== undefined && practitionerId === undefined)
  ) {
    return;
  }
  const existingSnapshot = await ctx.db
    .query("appointmentRestoreSnapshots")
    .withIndex("by_originalAppointmentId", (q) =>
      q.eq("originalAppointmentId", appointment._id),
    )
    .first();
  if (existingSnapshot) {
    await ctx.db.delete("appointmentRestoreSnapshots", existingSnapshot._id);
  }

  await ctx.db.insert("appointmentRestoreSnapshots", {
    appointmentTypeId: asAppointmentTypeId(appointmentTypeId),
    ...(appointment.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: appointment.bookingIdentityId }),
    ...(appointment.occupancyScope.kind === "resource"
      ? {
          calendarResourceColumn:
            appointment.occupancyScope.calendarResourceColumn,
        }
      : {}),
    ...(appointment.color === undefined ? {} : { color: appointment.color }),
    deletedAt,
    end: appointment.end,
    ...(appointment.isSimulation === undefined
      ? {}
      : { isSimulation: appointment.isSimulation }),
    locationId: asLocationId(locationId),
    originalAppointmentId: appointment._id,
    ...(appointment.patientId === undefined
      ? {}
      : { patientId: appointment.patientId }),
    ...(appointment.phoneBookingIdentityId === undefined
      ? {}
      : { phoneBookingIdentityId: appointment.phoneBookingIdentityId }),
    practiceId: appointment.practiceId,
    ...(practitionerId === undefined
      ? {}
      : { practitionerId: asPractitionerId(practitionerId) }),
    ...(appointment.replacesAppointmentId === undefined
      ? {}
      : { replacesAppointmentId: appointment.replacesAppointmentId }),
    ...(appointment.simulationKind === undefined
      ? {}
      : { simulationKind: appointment.simulationKind }),
    ...(appointment.simulationRuleSetId === undefined
      ? {}
      : { simulationRuleSetId: appointment.simulationRuleSetId }),
    ...(appointment.smiley === undefined ? {} : { smiley: appointment.smiley }),
    start: appointment.start,
    title: appointment.title,
    ...(appointment.userId === undefined ? {} : { userId: appointment.userId }),
  });
}

async function saveAppointmentSeriesRestoreSnapshot(
  ctx: MutationCtx,
  args: {
    appointments: AppointmentDoc[];
    deletedAt: bigint;
    series: AppointmentSeriesDoc;
  },
) {
  const snapshot = toAppointmentSeriesRestoreSnapshot({
    appointments: args.appointments,
    series: args.series,
  });
  const existingSnapshot = await ctx.db
    .query("appointmentSeriesRestoreSnapshots")
    .withIndex("by_originalSeriesId", (q) =>
      q.eq("originalSeriesId", args.series.seriesId),
    )
    .first();
  if (existingSnapshot) {
    await ctx.db.delete(
      "appointmentSeriesRestoreSnapshots",
      existingSnapshot._id,
    );
  }

  await ctx.db.insert("appointmentSeriesRestoreSnapshots", {
    deletedAt: args.deletedAt,
    originalSeriesId: args.series.seriesId,
    practiceId: args.series.practiceId,
    snapshot,
  });
}

function simulationReplacementMatchesRealAppointment(
  replacement: AppointmentDoc,
  real: AppointmentDoc,
  replacementSmiley: AppointmentSmiley | undefined,
) {
  return appointmentReplacementStatesEqual(
    appointmentReplacementState(replacement, { smiley: replacementSmiley }),
    appointmentReplacementState(real),
  );
}

function toAppointmentSeriesRestoreSnapshot(args: {
  appointments: AppointmentDoc[];
  series: AppointmentSeriesDoc;
}): Infer<typeof appointmentSeriesRestoreSnapshotValidator> {
  return {
    appointments: args.appointments.map((appointment) => ({
      appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
      appointmentTypeTitle: appointment.appointmentTypeTitle,
      ...(appointment.bookingIdentityId === undefined
        ? {}
        : { bookingIdentityId: appointment.bookingIdentityId }),
      ...(appointment.cancelledAt === undefined
        ? {}
        : { cancelledAt: appointment.cancelledAt }),
      ...(appointment.cancelledByPhoneBookingIdentityId === undefined
        ? {}
        : {
            cancelledByPhoneBookingIdentityId:
              appointment.cancelledByPhoneBookingIdentityId,
          }),
      ...(appointment.cancelledByUserId === undefined
        ? {}
        : { cancelledByUserId: appointment.cancelledByUserId }),
      createdAt: appointment.createdAt,
      end: appointment.end,
      ...(appointment.isSimulation === undefined
        ? {}
        : { isSimulation: appointment.isSimulation }),
      lastModified: appointment.lastModified,
      locationLineageKey: appointment.locationLineageKey,
      occupancyScope: appointment.occupancyScope,
      originalAppointmentId: appointment._id,
      ...(appointment.patientId === undefined
        ? {}
        : { patientId: appointment.patientId }),
      ...(appointment.phoneBookingIdentityId === undefined
        ? {}
        : { phoneBookingIdentityId: appointment.phoneBookingIdentityId }),
      practiceId: appointment.practiceId,
      ...(appointment.reassignmentSourceVacationLineageKey === undefined
        ? {}
        : {
            reassignmentSourceVacationLineageKey:
              appointment.reassignmentSourceVacationLineageKey,
          }),
      ...(appointment.replacesAppointmentId === undefined
        ? {}
        : { replacesAppointmentId: appointment.replacesAppointmentId }),
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
      ...(appointment.smiley === undefined
        ? {}
        : { smiley: appointment.smiley }),
      start: appointment.start,
      title: appointment.title,
      ...(appointment.userId === undefined
        ? {}
        : { userId: appointment.userId }),
    })),
    series: {
      appointmentPlanSnapshot: args.series.appointmentPlanSnapshot,
      ...(args.series.bookingIdentityId === undefined
        ? {}
        : { bookingIdentityId: args.series.bookingIdentityId }),
      createdAt: args.series.createdAt,
      lastModified: args.series.lastModified,
      ...(args.series.patientDateOfBirth === undefined
        ? {}
        : { patientDateOfBirth: args.series.patientDateOfBirth }),
      ...(args.series.patientId === undefined
        ? {}
        : { patientId: args.series.patientId }),
      practiceId: args.series.practiceId,
      rootAppointmentId: args.series.rootAppointmentId,
      rootAppointmentTypeId: args.series.rootAppointmentTypeId,
      rootAppointmentTypeLineageKey: args.series.rootAppointmentTypeLineageKey,
      rootDurationMinutes: args.series.rootDurationMinutes,
      ruleSetIdAtBooking: args.series.ruleSetIdAtBooking,
      scope: args.series.scope,
      seriesId: args.series.seriesId,
      ...(args.series.userId === undefined
        ? {}
        : { userId: args.series.userId }),
    },
  };
}

async function tryResolveAppointmentTypeIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: AppointmentTypeLineageKey;
    ruleSetId: Id<"ruleSets">;
  },
) {
  const direct = await db.get("appointmentTypes", args.lineageKey);
  const effectiveLineageKey = direct
    ? asAppointmentTypeLineageKey(
        requireLineageKey({
          entityId: direct._id,
          entityType: "appointment type",
          lineageKey: direct.lineageKey,
          ruleSetId: direct.ruleSetId,
        }),
      )
    : args.lineageKey;
  const entity = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return asAppointmentTypeId(entity._id);
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return asAppointmentTypeId(direct._id);
  }

  return;
}

async function tryResolveLocationIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: LocationLineageKey;
    ruleSetId: Id<"ruleSets">;
  },
) {
  const direct = await db.get("locations", args.lineageKey);
  const effectiveLineageKey = direct
    ? asLocationLineageKey(
        requireLineageKey({
          entityId: direct._id,
          entityType: "location",
          lineageKey: direct.lineageKey,
          ruleSetId: direct.ruleSetId,
        }),
      )
    : args.lineageKey;
  const entity = await db
    .query("locations")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return asLocationId(entity._id);
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return asLocationId(direct._id);
  }

  return;
}

async function tryResolvePractitionerIdForRuleSetByLineage(
  db: DatabaseReader,
  args: {
    lineageKey: PractitionerLineageKey;
    ruleSetId: Id<"ruleSets">;
  },
) {
  const direct = await db.get("practitioners", args.lineageKey);
  const effectiveLineageKey = direct
    ? asPractitionerLineageKey(
        requireLineageKey({
          entityId: direct._id,
          entityType: "practitioner",
          lineageKey: direct.lineageKey,
          ruleSetId: direct.ruleSetId,
        }),
      )
    : args.lineageKey;
  const entity = await db
    .query("practitioners")
    .withIndex("by_ruleSetId_lineageKey", (q) =>
      q.eq("ruleSetId", args.ruleSetId).eq("lineageKey", effectiveLineageKey),
    )
    .first();

  if (entity) {
    return asPractitionerId(entity._id);
  }

  if (direct?.ruleSetId === args.ruleSetId) {
    return asPractitionerId(direct._id);
  }

  return;
}

/**
 * Remaps entity IDs in appointments from source rule set to target rule set.
 */
interface AppointmentDisplayScope {
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

interface DisplayRuleSetArgs {
  activeRuleSetId?: Id<"ruleSets">;
  selectedRuleSetId?: Id<"ruleSets">;
}

interface RequiredDisplayRuleSetArgs {
  activeRuleSetId: Id<"ruleSets">;
  selectedRuleSetId?: Id<"ruleSets">;
}

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

function combineForSimulationScope<
  T extends Pick<
    AppointmentDoc,
    "_id" | "isSimulation" | "replacesAppointmentId" | "start"
  >,
>(appointments: T[]): T[] {
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

function dedupeById<T extends { _id: string }>(records: T[]): T[] {
  const dedupedRecords = new Map<string, T>();

  for (const record of records) {
    dedupedRecords.set(record._id, record);
  }

  return [...dedupedRecords.values()];
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

function filterAppointmentsForVisibleScope<T extends AppointmentDoc>(
  appointments: T[],
  args: {
    activeRuleSetId?: Id<"ruleSets">;
    selectedRuleSetId?: Id<"ruleSets">;
  },
  scope: AppointmentScope,
) {
  const scopedAppointments = filterAppointmentsForScope(
    appointments,
    args,
    scope,
  );
  if (scope === "all") {
    return scopedAppointments.filter((appointment) =>
      isVisibleAppointment(appointment),
    );
  }
  return filterCurrentAppointmentReplacementTails(scopedAppointments);
}

function filterBlockedSlotsForCalendarDay(
  blockedSlots: BlockedSlotDoc[],
  args: {
    dayEnd: string;
    dayStart: string;
    selectedLocationLineageKey: LocationLineageKey | undefined;
  },
): BlockedSlotDoc[] {
  return blockedSlots.filter(
    (blockedSlot) =>
      isCalendarDayRangeMatch(args, blockedSlot.start) &&
      (args.selectedLocationLineageKey === undefined ||
        blockedSlot.locationLineageKey === args.selectedLocationLineageKey),
  );
}

function getDisplayRuleSetId(args: DisplayRuleSetArgs) {
  return args.selectedRuleSetId ?? args.activeRuleSetId;
}

function getDisplayRuleSetIdFromScope(
  displayScope: AppointmentDisplayScope | undefined,
): Id<"ruleSets"> | undefined {
  return displayScope?.ruleSetId;
}

function getLegacyHoldScopeForDisplayScope(
  displayScope: AppointmentDisplayScope,
): LegacyUnmatchedFutureBookingHoldScope {
  return { practiceId: displayScope.practiceId };
}

async function getOptionalLocationLineageKey(
  db: DatabaseReader,
  locationId: Id<"locations"> | undefined,
): Promise<LocationLineageKey | undefined> {
  if (!locationId) {
    return;
  }

  return await resolveLocationLineageKey(db, asLocationId(locationId), {
    allowDeleted: true,
  });
}

function getRangeOverlapBounds(args: { end: string; start: string }): {
  queryEndExclusive: string;
  queryStartInclusive: string;
} {
  const dayStart = Temporal.ZonedDateTime.from(args.start)
    .toPlainDate()
    .toZonedDateTime(APPOINTMENT_TIMEZONE);
  const dayEndExclusive = Temporal.ZonedDateTime.from(args.end)
    .toPlainDate()
    .add({ days: 1 })
    .toZonedDateTime(APPOINTMENT_TIMEZONE);

  return {
    queryEndExclusive: dayEndExclusive.toString(),
    queryStartInclusive: dayStart.subtract({ days: 1 }).toString(),
  };
}

async function getSimulationAppointmentReplacements(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
  replacedAppointmentIds: Id<"appointments">[],
): Promise<AppointmentDoc[]> {
  if (replacedAppointmentIds.length === 0) {
    return [];
  }

  const replacedAppointmentIdSet = new Set(replacedAppointmentIds);
  const simulationAppointments = await ctx.db
    .query("appointments")
    .withIndex("by_practiceId_isSimulation", (q) =>
      q.eq("practiceId", practiceId).eq("isSimulation", true),
    )
    .collect();

  return dedupeById(
    simulationAppointments.filter(
      (appointment) =>
        appointment.replacesAppointmentId !== undefined &&
        replacedAppointmentIdSet.has(appointment.replacesAppointmentId) &&
        isVisibleAppointment(appointment),
    ),
  );
}

async function getSimulationBlockedSlotReplacements(
  ctx: QueryCtx,
  practiceId: Id<"practices">,
  replacedBlockedSlotIds: Id<"blockedSlots">[],
): Promise<BlockedSlotDoc[]> {
  if (replacedBlockedSlotIds.length === 0) {
    return [];
  }

  const replacedBlockedSlotIdSet = new Set(replacedBlockedSlotIds);
  const simulationBlockedSlots = await ctx.db
    .query("blockedSlots")
    .withIndex("by_practiceId_isSimulation", (q) =>
      q.eq("practiceId", practiceId).eq("isSimulation", true),
    )
    .collect();

  return dedupeById(
    simulationBlockedSlots.filter(
      (blockedSlot) =>
        blockedSlot.replacesBlockedSlotId !== undefined &&
        replacedBlockedSlotIdSet.has(blockedSlot.replacesBlockedSlotId),
    ),
  );
}

function getSimulationScopeRuleSetId(args: {
  activeRuleSetId?: Id<"ruleSets">;
  selectedRuleSetId?: Id<"ruleSets">;
}) {
  return args.selectedRuleSetId ?? args.activeRuleSetId;
}

function isAppointmentInCalendarDayRange(
  appointment: Pick<AppointmentDoc, "start">,
  args: { dayEnd: string; dayStart: string },
) {
  return isCalendarDayRangeMatch(args, appointment.start);
}

function isAppointmentInSelectedLocation(
  appointment: Pick<AppointmentDoc, "locationLineageKey">,
  selectedLocationLineageKey: LocationLineageKey | undefined,
): boolean {
  return (
    selectedLocationLineageKey === undefined ||
    appointment.locationLineageKey === selectedLocationLineageKey
  );
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

function isTimeRangeOverlap(
  record: Pick<AppointmentDoc | BlockedSlotDoc, "end" | "start">,
  range: { end: string; start: string },
): boolean {
  return record.start < range.end && record.end > range.start;
}

async function remapAppointmentIds(
  ctx: { db: DatabaseReader },
  appointments: AppointmentDoc[],
  targetRuleSetId: Id<"ruleSets">,
): Promise<AppointmentListItem[]> {
  const appointmentTypeCache = new Map<
    AppointmentTypeLineageKey,
    Promise<{
      appointmentTypeId: Id<"appointmentTypes">;
      appointmentTypeTitle: string;
    }>
  >();
  const locationCache = new Map<LocationLineageKey, Promise<Id<"locations">>>();
  const practitionerCache = new Map<
    PractitionerLineageKey,
    Promise<Id<"practitioners">>
  >();
  const resolveAppointmentType = (
    lineageKey: AppointmentTypeLineageKey,
  ): Promise<{
    appointmentTypeId: Id<"appointmentTypes">;
    appointmentTypeTitle: string;
  }> => {
    const existing = appointmentTypeCache.get(lineageKey);
    if (existing) {
      return existing;
    }
    const resolved = resolveAppointmentTypeForDisplayRuleSet(
      ctx.db,
      lineageKey,
      targetRuleSetId,
    );
    appointmentTypeCache.set(lineageKey, resolved);
    return resolved;
  };
  const resolveLocation = (
    lineageKey: LocationLineageKey,
  ): Promise<Id<"locations">> => {
    const existing = locationCache.get(lineageKey);
    if (existing) {
      return existing;
    }
    const resolved = resolveLocationIdForDisplayRuleSet(
      ctx.db,
      lineageKey,
      targetRuleSetId,
    );
    locationCache.set(lineageKey, resolved);
    return resolved;
  };
  const resolvePractitioner = (
    lineageKey: PractitionerLineageKey,
  ): Promise<Id<"practitioners">> => {
    const existing = practitionerCache.get(lineageKey);
    if (existing) {
      return existing;
    }
    const resolved = resolvePractitionerIdForDisplayRuleSet(
      ctx.db,
      lineageKey,
      targetRuleSetId,
    );
    practitionerCache.set(lineageKey, resolved);
    return resolved;
  };

  const remappedAppointments = await Promise.all(
    appointments.map(async (appointment) => {
      try {
        const displayAppointmentType = await resolveAppointmentType(
          asAppointmentTypeLineageKey(appointment.appointmentTypeLineageKey),
        );
        const remappedAppointment: AppointmentListItem = {
          ...toAppointmentListItem(appointment),
          appointmentTypeId: displayAppointmentType.appointmentTypeId,
          appointmentTypeTitle: displayAppointmentType.appointmentTypeTitle,
          locationId: await resolveLocation(
            asLocationLineageKey(appointment.locationLineageKey),
          ),
        };
        const practitionerLineageKey = getAppointmentPractitionerLineageKey(
          appointment.occupancyScope,
        );
        if (practitionerLineageKey) {
          remappedAppointment.practitionerId = await resolvePractitioner(
            asPractitionerLineageKey(practitionerLineageKey),
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

async function requireActiveRuleSetIdForPractice(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<Id<"ruleSets">> {
  const practice = await db.get("practices", practiceId);
  if (!practice) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Practice not found.",
    });
  }
  if (!practice.currentActiveRuleSetId) {
    throw new ConvexError({
      code: "INVALID_ARGUMENT",
      message: "Practice has no active rule set.",
    });
  }
  return practice.currentActiveRuleSetId;
}

async function requireAppointmentDisplayScope(
  db: DatabaseReader,
  args: RequiredDisplayRuleSetArgs,
): Promise<AppointmentDisplayScope> {
  const displayScope = await resolveAppointmentDisplayScope(db, args);
  if (displayScope === undefined) {
    throw new ConvexError({
      code: "INVALID_ARGUMENT",
      message: "A display rule set is required.",
    });
  }
  return displayScope;
}

async function requireDisplayRuleSetArgsBelongToPractice(
  ctx: QueryCtx,
  args: DisplayRuleSetArgs & { practiceId: Id<"practices"> },
): Promise<void> {
  if (args.activeRuleSetId) {
    await requireRuleSetBelongsToPractice(
      ctx,
      args.activeRuleSetId,
      args.practiceId,
    );
  }
  if (args.selectedRuleSetId) {
    await requireRuleSetBelongsToPractice(
      ctx,
      args.selectedRuleSetId,
      args.practiceId,
    );
  }
}

async function resolveAppointmentDisplayScope(
  db: DatabaseReader,
  args: DisplayRuleSetArgs,
): Promise<AppointmentDisplayScope | undefined> {
  const displayRuleSetId = getDisplayRuleSetId(args);
  if (displayRuleSetId === undefined) {
    return undefined;
  }

  const displayRuleSet = await db.get("ruleSets", displayRuleSetId);
  if (!displayRuleSet) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Display rule set not found.",
    });
  }

  return {
    practiceId: displayRuleSet.practiceId,
    ruleSetId: displayRuleSetId,
  };
}

function toAppointmentListItem(
  appointment: AppointmentDoc,
): AppointmentListItem {
  const timeRange = asTypedDateTimeRange(appointment);
  const practitionerLineageKey = getAppointmentPractitionerLineageKey(
    appointment.occupancyScope,
  );
  return {
    _creationTime: appointment._creationTime,
    _id: appointment._id,
    appointmentTypeId: appointment.appointmentTypeLineageKey,
    appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
    appointmentTypeTitle: appointment.appointmentTypeTitle,
    color: appointment.color ?? DEFAULT_APPOINTMENT_COLOR,
    createdAt: appointment.createdAt,
    ...timeRange,
    lastModified: appointment.lastModified,
    locationId: appointment.locationLineageKey,
    locationLineageKey: appointment.locationLineageKey,
    occupancyScope: appointment.occupancyScope,
    practiceId: appointment.practiceId,
    ...(appointment.cancelledAt === undefined
      ? {}
      : { cancelledAt: appointment.cancelledAt }),
    ...(appointment.bookingIdentityId === undefined
      ? {}
      : { bookingIdentityId: appointment.bookingIdentityId }),
    ...(appointment.cancelledByPhoneBookingIdentityId === undefined
      ? {}
      : {
          cancelledByPhoneBookingIdentityId:
            appointment.cancelledByPhoneBookingIdentityId,
        }),
    ...(appointment.isSimulation === undefined
      ? {}
      : { isSimulation: appointment.isSimulation }),
    ...(appointment.patientId === undefined
      ? {}
      : { patientId: appointment.patientId }),
    ...(appointment.phoneBookingIdentityId === undefined
      ? {}
      : { phoneBookingIdentityId: appointment.phoneBookingIdentityId }),
    ...(practitionerLineageKey
      ? {
          practitionerId: practitionerLineageKey,
        }
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
    ...(appointment.smiley === undefined ? {} : { smiley: appointment.smiley }),
    title: appointment.title,
    ...(appointment.userId === undefined ? {} : { userId: appointment.userId }),
  };
}

function toBookedAppointmentSummaryItem(
  appointment: AppointmentListItem,
): BookedAppointmentSummaryItem {
  const { smiley: _smiley, ...summary } = appointment;
  void _smiley;
  return {
    ...summary,
    kind: "appointment",
  };
}

// Query to get all appointments
export const getAppointments = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    practiceId: v.id("practices"),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    await requireDisplayRuleSetArgsBelongToPractice(ctx, args);
    const scope: AppointmentScope = args.scope ?? "real";

    const appointmentDocs = await ctx.db
      .query("appointments")
      .withIndex("by_practiceId_start", (q) =>
        q.eq("practiceId", args.practiceId),
      )
      .collect();
    const scopedAppointments = filterAppointmentsForVisibleScope(
      appointmentDocs,
      args,
      scope,
    );
    const displayScope = await resolveAppointmentDisplayScope(ctx.db, args);
    const displayRuleSetId = getDisplayRuleSetIdFromScope(displayScope);
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
    await requirePracticeStaff(ctx, args.practiceId);
    await requireDisplayRuleSetArgsBelongToPractice(ctx, args);

    const scope: AppointmentScope = args.scope ?? "real";
    const selectedLocationLineageKey = await getOptionalLocationLineageKey(
      ctx.db,
      args.locationId,
    );

    const appointmentDocs = await ctx.db
      .query("appointments")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", args.dayStart)
          .lt("start", args.dayEnd),
      )
      .collect();

    const dayAppointments = appointmentDocs.filter((appointment) =>
      isAppointmentInCalendarDayRange(appointment, args),
    );
    const dayScopedAppointments = filterAppointmentsForScope(
      dayAppointments,
      args,
      scope,
    );
    const simulationReplacementAppointments =
      scope === "simulation"
        ? filterAppointmentsForScope(
            await getSimulationAppointmentReplacements(
              ctx,
              args.practiceId,
              dayAppointments
                .filter((appointment) => appointment.isSimulation !== true)
                .map((appointment) => appointment._id),
            ),
            args,
            scope,
          )
        : [];
    const candidateAppointments = dedupeById([
      ...dayScopedAppointments,
      ...simulationReplacementAppointments,
    ]);
    const scopedAppointments =
      scope === "all"
        ? candidateAppointments.filter((appointment) =>
            isVisibleAppointment(appointment),
          )
        : filterCurrentAppointmentReplacementTails(candidateAppointments);
    const resolvedAppointments =
      scope === "simulation"
        ? combineForSimulationScope(scopedAppointments).filter((appointment) =>
            isAppointmentInCalendarDayRange(appointment, args),
          )
        : scopedAppointments.toSorted((left, right) =>
            left.start.localeCompare(right.start),
          );
    const visibleAppointments = resolvedAppointments.filter((appointment) =>
      isAppointmentInSelectedLocation(appointment, selectedLocationLineageKey),
    );
    const displayScope = await resolveAppointmentDisplayScope(ctx.db, args);
    const displayRuleSetId = getDisplayRuleSetIdFromScope(displayScope);

    return displayRuleSetId
      ? await remapAppointmentIds(ctx, visibleAppointments, displayRuleSetId)
      : visibleAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        );
  },
  returns: v.array(appointmentResultValidator),
});

// Query to get appointments in a date range
export const getAppointmentsInRange = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    end: v.string(),
    practiceId: v.id("practices"),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
    start: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    await requireDisplayRuleSetArgsBelongToPractice(ctx, args);
    const rangeOverlapBounds = getRangeOverlapBounds(args);
    const appointmentDocs = await ctx.db
      .query("appointments")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", rangeOverlapBounds.queryStartInclusive)
          .lt("start", rangeOverlapBounds.queryEndExclusive),
      )
      .collect();

    const scope: AppointmentScope = args.scope ?? "real";
    const scopedAppointments = filterAppointmentsForVisibleScope(
      appointmentDocs,
      args,
      scope,
    ).filter((appointment) => isTimeRangeOverlap(appointment, args));

    const displayScope = await resolveAppointmentDisplayScope(ctx.db, args);
    const displayRuleSetId = getDisplayRuleSetIdFromScope(displayScope);
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
    await requirePracticeStaff(ctx, args.practiceId);
    await validateAppointmentSeriesOwnerRefs(ctx, {
      practiceId: args.practiceId,
      ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
      ...(args.userId === undefined ? {} : { userId: args.userId }),
    });
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

const appointmentSeriesResourceRootSlotValidator = v.object({
  calendarResourceColumn: calendarResourceColumnValidator,
  duration: v.number(),
  locationLineageKey: v.id("locations"),
  startTime: v.string(),
  status: v.literal("AVAILABLE"),
});

type AppointmentSeriesResourceRootSlot = Infer<
  typeof appointmentSeriesResourceRootSlotValidator
>;

export const getNextAvailableResourceSeriesRootSlot = query({
  args: {
    date: v.string(),
    isNewPatient: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientDateOfBirth: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    rootAppointmentTypeId: v.id("appointmentTypes"),
    ruleSetId: v.id("ruleSets"),
    scope: v.optional(v.union(v.literal("real"), v.literal("simulation"))),
    userId: v.optional(v.id("users")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<AppointmentSeriesResourceRootSlot | null> => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    await validateAppointmentSeriesOwnerRefs(ctx, {
      practiceId: args.practiceId,
      ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
      ...(args.userId === undefined ? {} : { userId: args.userId }),
    });

    const rootAppointmentType = await ctx.db.get(
      "appointmentTypes",
      args.rootAppointmentTypeId,
    );
    if (
      rootAppointmentType?.practiceId !== args.practiceId ||
      rootAppointmentType.ruleSetId !== args.ruleSetId
    ) {
      return null;
    }

    const rootDefaultOccupancy = normalizeDefaultOccupancy(
      rootAppointmentType.defaultOccupancy,
    );
    if (rootDefaultOccupancy.kind !== "resourceColumn") {
      return null;
    }

    const locationLineageKey = await resolveLocationLineageKey(
      ctx.db,
      asLocationId(args.locationId),
    );
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
    const rangesByDayOfWeek = new Map<number, { end: string; start: string }>();
    for (const schedule of schedules) {
      if (
        schedule.practiceId !== args.practiceId ||
        schedule.locationLineageKey !== locationLineageKey
      ) {
        continue;
      }
      const existing = rangesByDayOfWeek.get(schedule.dayOfWeek);
      rangesByDayOfWeek.set(schedule.dayOfWeek, {
        end:
          existing === undefined || schedule.endTime > existing.end
            ? schedule.endTime
            : existing.end,
        start:
          existing === undefined || schedule.startTime < existing.start
            ? schedule.startTime
            : existing.start,
      });
    }
    if (rangesByDayOfWeek.size === 0) {
      return null;
    }

    const patientDateOfBirth =
      args.patientDateOfBirth === undefined
        ? args.patientId === undefined
          ? undefined
          : await resolvePreferredAppointmentPatientDateOfBirth(ctx.db, {
              patientId: args.patientId,
            })
        : asOptionalIsoDateString(args.patientDateOfBirth);
    const startDate = Temporal.PlainDate.from(asIsoDateString(args.date));
    const now = Temporal.Now.zonedDateTimeISO(APPOINTMENT_TIMEZONE);
    const requestedAt = asInstantString(Temporal.Now.instant().toString());
    const planningState = createSeriesPlanningState();
    const maxSearchDays = 90;
    const slotDurationMinutes = 5;
    const appointmentHasPlan = hasAppointmentPlan(rootAppointmentType);

    for (let offset = 0; offset <= maxSearchDays; offset += 1) {
      const day = startDate.add({ days: offset });
      const dayOfWeek = day.dayOfWeek === 7 ? 0 : day.dayOfWeek;
      const range = rangesByDayOfWeek.get(dayOfWeek);
      if (range === undefined) {
        continue;
      }

      const [startHourText, startMinuteText] = range.start.split(":");
      const [endHourText, endMinuteText] = range.end.split(":");
      const rangeStartMinutes =
        Number(startHourText) * 60 + Number(startMinuteText);
      const rangeEndMinutes = Number(endHourText) * 60 + Number(endMinuteText);
      for (
        let minuteOfDay = rangeStartMinutes;
        minuteOfDay + rootAppointmentType.duration <= rangeEndMinutes;
        minuteOfDay += slotDurationMinutes
      ) {
        const start = day.toZonedDateTime({
          plainTime: {
            hour: Math.floor(minuteOfDay / 60),
            minute: minuteOfDay % 60,
          },
          timeZone: APPOINTMENT_TIMEZONE,
        });
        if (Temporal.ZonedDateTime.compare(start, now) <= 0) {
          continue;
        }

        const hasSchedulerAvailability =
          await hasResourceRootSchedulerAvailability(ctx, {
            appointmentType: rootAppointmentType,
            ...(args.isNewPatient === undefined
              ? {}
              : { isNewPatient: args.isNewPatient }),
            locationId: args.locationId,
            planningState,
            ...(patientDateOfBirth === undefined ? {} : { patientDateOfBirth }),
            practiceId: args.practiceId,
            requestedAt,
            rootDurationMinutes: rootAppointmentType.duration,
            ruleSetId: args.ruleSetId,
            ...(args.scope === undefined ? {} : { scope: args.scope }),
            start: asZonedDateTimeString(start.toString()),
          });
        if (!hasSchedulerAvailability) {
          continue;
        }

        if (appointmentHasPlan) {
          const preview = await previewAppointmentSeriesHelper(ctx, {
            ...(args.isNewPatient === undefined
              ? {}
              : { isNewPatient: args.isNewPatient }),
            calendarResourceColumn: rootDefaultOccupancy.calendarResourceColumn,
            locationId: args.locationId,
            ...(patientDateOfBirth === undefined ? {} : { patientDateOfBirth }),
            ...(args.patientId === undefined
              ? {}
              : { patientId: args.patientId }),
            practiceId: args.practiceId,
            rootAppointmentTypeId: args.rootAppointmentTypeId,
            ruleSetId: args.ruleSetId,
            ...(args.scope === undefined ? {} : { scope: args.scope }),
            start: asZonedDateTimeString(start.toString()),
            ...(args.userId === undefined ? {} : { userId: args.userId }),
          });

          if (preview.status !== "ready") {
            continue;
          }
        } else {
          const conflictingOccupancy = await findConflictingCalendarOccupancy(
            ctx.db,
            {
              candidate: {
                end: start
                  .add({ minutes: rootAppointmentType.duration })
                  .toString(),
                locationLineageKey,
                occupancyScope: appointmentOccupancyScopeFromRefs({
                  calendarResourceColumn:
                    rootDefaultOccupancy.calendarResourceColumn,
                }),
                start: asZonedDateTimeString(start.toString()),
              },
              occupancyView: getOccupancyViewForBookingScope(
                args.scope ?? "real",
              ),
              practiceId: args.practiceId,
            },
          );
          if (conflictingOccupancy) {
            continue;
          }
        }

        return {
          calendarResourceColumn: rootDefaultOccupancy.calendarResourceColumn,
          duration: rootAppointmentType.duration,
          locationLineageKey,
          startTime: asZonedDateTimeString(start.toString()),
          status: "AVAILABLE",
        };
      }
    }

    return null;
  },
  returns: v.union(v.null(), appointmentSeriesResourceRootSlotValidator),
});

const appointmentSeriesBlockedRootSlotValidator = v.object({
  duration: v.number(),
  locationLineageKey: v.id("locations"),
  practitionerLineageKey: v.id("practitioners"),
  practitionerName: v.string(),
  reason: v.optional(v.string()),
  startTime: v.string(),
  status: v.literal("BLOCKED"),
});

const appointmentSeriesRootSlotCandidateValidator = v.object({
  duration: v.number(),
  locationLineageKey: v.id("locations"),
  practitionerLineageKey: v.id("practitioners"),
  practitionerName: v.string(),
  startTime: v.string(),
});

type AppointmentSeriesBlockedRootSlot = Infer<
  typeof appointmentSeriesBlockedRootSlotValidator
>;

export const getBlockedAppointmentSeriesRootSlotsForCandidates = query({
  args: {
    candidates: v.array(appointmentSeriesRootSlotCandidateValidator),
    isNewPatient: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientDateOfBirth: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    rootAppointmentTypeId: v.id("appointmentTypes"),
    ruleSetId: v.id("ruleSets"),
    scope: v.optional(v.union(v.literal("real"), v.literal("simulation"))),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    await validateAppointmentSeriesOwnerRefs(ctx, {
      practiceId: args.practiceId,
      ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
      ...(args.userId === undefined ? {} : { userId: args.userId }),
    });

    const rootAppointmentType = await ctx.db.get(
      "appointmentTypes",
      args.rootAppointmentTypeId,
    );
    if (
      rootAppointmentType?.practiceId !== args.practiceId ||
      rootAppointmentType.ruleSetId !== args.ruleSetId ||
      !hasAppointmentPlan(rootAppointmentType)
    ) {
      return [];
    }

    const rootDefaultOccupancy = normalizeDefaultOccupancy(
      rootAppointmentType.defaultOccupancy,
    );
    if (rootDefaultOccupancy.kind === "resourceColumn") {
      return [];
    }

    const locationLineageKey = await resolveLocationLineageKey(
      ctx.db,
      asLocationId(args.locationId),
    );
    const patientDateOfBirth =
      args.patientDateOfBirth === undefined
        ? args.patientId === undefined
          ? undefined
          : await resolvePreferredAppointmentPatientDateOfBirth(ctx.db, {
              patientId: args.patientId,
            })
        : asOptionalIsoDateString(args.patientDateOfBirth);

    const blockedRootSlots: AppointmentSeriesBlockedRootSlot[] = [];
    for (const candidate of args.candidates) {
      if (candidate.locationLineageKey !== locationLineageKey) {
        continue;
      }

      const practitionerId = await resolvePractitionerIdForRuleSetByLineage(
        ctx.db,
        {
          lineageKey: asPractitionerLineageKey(
            candidate.practitionerLineageKey,
          ),
          ruleSetId: args.ruleSetId,
        },
      );
      const preview = await previewAppointmentSeriesHelper(ctx, {
        ...(args.isNewPatient === undefined
          ? {}
          : { isNewPatient: args.isNewPatient }),
        locationId: args.locationId,
        ...(patientDateOfBirth === undefined ? {} : { patientDateOfBirth }),
        ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
        practiceId: args.practiceId,
        practitionerId,
        rootAppointmentTypeId: args.rootAppointmentTypeId,
        ruleSetId: args.ruleSetId,
        ...(args.scope === undefined ? {} : { scope: args.scope }),
        start: asZonedDateTimeString(candidate.startTime),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
      });

      if (preview.status === "blocked") {
        blockedRootSlots.push({
          duration: candidate.duration,
          locationLineageKey,
          practitionerLineageKey: asPractitionerLineageKey(
            candidate.practitionerLineageKey,
          ),
          practitionerName: candidate.practitionerName,
          reason:
            preview.failureMessage ??
            "Die Kettentermine sind für diesen Starttermin nicht planbar.",
          startTime: candidate.startTime,
          status: "BLOCKED" as const,
        });
      }
    }

    return blockedRootSlots;
  },
  returns: v.array(appointmentSeriesBlockedRootSlotValidator),
});

export const createAppointmentSeries = mutation({
  args: {
    ...appointmentSeriesArgsValidator,
    rootReplacesAppointmentId: v.optional(v.id("appointments")),
    rootTitle: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaffForMutation(ctx, args.practiceId);

    if (!args.patientId && !args.userId) {
      throw new Error("Either patientId or userId must be provided.");
    }
    await validateAppointmentSeriesOwnerRefs(ctx, {
      practiceId: args.practiceId,
      ...(args.patientId === undefined ? {} : { patientId: args.patientId }),
      ...(args.userId === undefined ? {} : { userId: args.userId }),
    });

    if (args.bookingIdentityId) {
      const bookingIdentity = await ctx.db.get(
        "bookingIdentities",
        args.bookingIdentityId,
      );
      if (!bookingIdentity) {
        throw new Error(
          `Booking Identity with ID ${args.bookingIdentityId} not found`,
        );
      }
      if (bookingIdentity.practiceId !== args.practiceId) {
        throw new Error(
          "Booking identity does not belong to the appointment practice.",
        );
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
    allowHistoricalSmiley?: boolean;
    allowRestoredEnd?: boolean;
    allowUnrelatedUserId?: boolean;
    appointmentTypeId: Id<"appointmentTypes">;
    bookingIdentityId?: Id<"bookingIdentities">;
    calendarResourceColumn?: "ekg" | "labor";
    color?: AppointmentColor;
    end?: string;
    isNewPatient?: boolean;
    isSimulation?: boolean;
    locationId: Id<"locations">;
    patientDateOfBirth?: string;
    patientId?: Id<"patients">;
    phoneBookingIdentityId?: Id<"phoneBookingIdentities">;
    practiceId: Id<"practices">;
    practitionerId?: Id<"practitioners">;
    replacesAppointmentId?: Id<"appointments">;
    simulationKind?: AppointmentSimulationKind;
    simulationRuleSetId?: Id<"ruleSets">;
    smiley?: AppointmentSmiley;
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
    allowHistoricalSmiley,
    allowRestoredEnd,
    allowUnrelatedUserId,
    appointmentTypeId,
    calendarResourceColumn,
    color: requestedColor,
    end: requestedEnd,
    isNewPatient,
    isSimulation,
    locationId,
    patientDateOfBirth,
    practiceId,
    practitionerId,
    replacesAppointmentId,
    simulationKind,
    simulationRuleSetId,
    smiley,
    title,
  } = args;

  if (replacesAppointmentId && isSimulation !== true) {
    throw new Error(
      "Only simulated appointments can replace existing appointments.",
    );
  }
  if (
    requestedEnd !== undefined &&
    replacesAppointmentId === undefined &&
    allowRestoredEnd !== true
  ) {
    throw new Error(
      "Eine explizite Endzeit kann nur für simulierte Ersatztermine gesetzt werden.",
    );
  }
  const owner = parseAppointmentOwner(args);
  const allowsMissingLinkedRecords =
    isSimulation === true && replacesAppointmentId !== undefined;
  const ownerRefs = await resolveAppointmentOwnerRefs(ctx, {
    allowsMissingLinkedRecords,
    allowUnrelatedUserId: allowUnrelatedUserId === true,
    owner,
    scope: await requireTrustedPracticeScope(ctx, practiceId),
  });
  if (simulationKind && isSimulation !== true) {
    throw new Error(
      "simulationKind can only be used with simulated appointments.",
    );
  }

  // Look up the appointment type to get its name at booking time
  const appointmentType = await ctx.db.get(
    "appointmentTypes",
    appointmentTypeId,
  );
  const loadedAppointmentType = requireEntityUsableForNewAppointment({
    entity: appointmentType,
    entityId: appointmentTypeId,
    entityLabel: "Terminart",
  });
  const activeAppointmentType = await requireAppointmentTypeInPracticeRuleSet(
    ctx.db,
    {
      appointmentTypeId,
      scope: await requireTrustedRuleSetScope(ctx, {
        practiceId,
        ruleSetId: loadedAppointmentType.ruleSetId,
      }),
    },
  );

  const location = await requireLocationInPracticeRuleSet(ctx.db, {
    locationId,
    scope: await requireTrustedRuleSetScope(ctx, {
      practiceId,
      ruleSetId: activeAppointmentType.ruleSetId,
    }),
  });
  requireEntityUsableForNewAppointment({
    entity: location,
    entityId: locationId,
    entityLabel: "Standort",
  });

  if (practitionerId) {
    const practitioner = await requirePractitionerInPracticeRuleSet(ctx.db, {
      practitionerId,
      scope: await requireTrustedRuleSetScope(ctx, {
        practiceId,
        ruleSetId: activeAppointmentType.ruleSetId,
      }),
    });
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
  if (smiley !== undefined) {
    if (allowHistoricalSmiley === true) {
      await requireKnownAppointmentSmiley(ctx.db, {
        practiceId,
        smiley,
      });
    } else {
      await requireConfiguredAppointmentSmiley(ctx.db, {
        practiceId,
        ...(resolvedSimulationRuleSetId === undefined
          ? {}
          : { ruleSetId: resolvedSimulationRuleSetId }),
        smiley,
      });
    }
  }

  if (hasAppointmentPlan(activeAppointmentType)) {
    if (ownerRefs.phoneBookingIdentityId !== undefined) {
      throw new Error("TelefonKI can only book a single appointment.");
    }

    const result = await createAppointmentSeriesHelper(ctx, {
      ...(ownerRefs.bookingIdentityId !== undefined && {
        bookingIdentityId: ownerRefs.bookingIdentityId,
      }),
      ...(calendarResourceColumn !== undefined && { calendarResourceColumn }),
      locationId,
      ...(isNewPatient !== undefined && { isNewPatient }),
      ...(patientDateOfBirth !== undefined && { patientDateOfBirth }),
      ...(ownerRefs.patientId !== undefined && {
        patientId: ownerRefs.patientId,
      }),
      practiceId,
      ...(practitionerId !== undefined && { practitionerId }),
      rootAppointmentTypeId: appointmentTypeId,
      ...(replacesAppointmentId && {
        rootReplacesAppointmentId: replacesAppointmentId,
      }),
      ...(requestedColor !== undefined && { rootColor: requestedColor }),
      ...(smiley !== undefined && { rootSmiley: smiley }),
      rootTitle: title.trim(),
      ruleSetId: activeAppointmentType.ruleSetId,
      scope: getAppointmentBookingScope(isSimulation),
      ...(resolvedSimulationRuleSetId && {
        simulationRuleSetId: resolvedSimulationRuleSetId,
      }),
      start: args.start,
      ...(ownerRefs.userId !== undefined && { userId: ownerRefs.userId }),
    });

    return result.rootAppointmentId;
  }

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
  const occupancyScope = resolveSingleAppointmentOccupancy({
    appointmentType: activeAppointmentType,
    ...(calendarResourceColumn === undefined ? {} : { calendarResourceColumn }),
    storedReferences,
  });

  const end =
    requestedEnd ??
    calculateEndFromDuration(args.start, activeAppointmentType.duration);
  if (
    Temporal.ZonedDateTime.compare(
      Temporal.ZonedDateTime.from(end),
      Temporal.ZonedDateTime.from(args.start),
    ) <= 0
  ) {
    throw new Error("Die Endzeit muss nach der Startzeit liegen.");
  }

  const conflictingOccupancy = await findConflictingCalendarOccupancy(ctx.db, {
    candidate: {
      end,
      locationLineageKey: storedReferences.locationLineageKey,
      occupancyScope,
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

  if (conflictingOccupancy) {
    throw new Error("Der gewaehlte Zeitraum ist bereits belegt.");
  }

  const insertData = {
    appointmentTypeLineageKey: storedReferences.appointmentTypeLineageKey,
    appointmentTypeTitle: activeAppointmentType.name,
    ...(ownerRefs.bookingIdentityId !== undefined && {
      bookingIdentityId: ownerRefs.bookingIdentityId,
    }),
    color:
      requestedColor ??
      (await resolveAppointmentColorForType(ctx.db, activeAppointmentType)),
    createdAt: now,
    end,
    isSimulation: isSimulation ?? false,
    lastModified: now,
    locationLineageKey: storedReferences.locationLineageKey,
    occupancyScope,
    practiceId,
    ...(ownerRefs.patientId !== undefined && {
      patientId: ownerRefs.patientId,
    }),
    ...(ownerRefs.phoneBookingIdentityId !== undefined && {
      phoneBookingIdentityId: ownerRefs.phoneBookingIdentityId,
    }),
    start: args.start,
    ...(ownerRefs.userId !== undefined && { userId: ownerRefs.userId }),
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
    ...(smiley !== undefined && { smiley }),
    title,
  };
  return await ctx.db.insert("appointments", insertData);
}

async function resolveAppointmentOwnerRefs(
  ctx: MutationCtx,
  args: {
    allowsMissingLinkedRecords: boolean;
    allowUnrelatedUserId: boolean;
    owner: AppointmentOwner;
    scope: TrustedPracticeScope;
  },
): Promise<ResolvedAppointmentOwnerRefs> {
  if (args.owner.kind === "temporary") {
    return await createTemporaryPatientRecordWithIdentity(ctx, {
      name: args.owner.name,
      phoneNumber: args.owner.phoneNumber,
      practiceId: args.scope.practiceId,
    });
  }

  const resolvedRefs: ResolvedAppointmentOwnerRefs = {};

  if (args.owner.patientId !== undefined) {
    if (args.allowsMissingLinkedRecords) {
      const patient = await ctx.db.get("patients", args.owner.patientId);
      if (patient?.practiceId === args.scope.practiceId) {
        resolvedRefs.patientId = args.owner.patientId;
        if (
          patient.recordType === "temporary" &&
          patient.bookingIdentityId !== undefined
        ) {
          resolvedRefs.bookingIdentityId = patient.bookingIdentityId;
        }
      }
    } else {
      const patient = await requirePatientInPractice(ctx.db, {
        patientId: args.owner.patientId,
        scope: args.scope,
      });
      resolvedRefs.patientId = args.owner.patientId;
      if (
        patient.recordType === "temporary" &&
        patient.bookingIdentityId !== undefined
      ) {
        resolvedRefs.bookingIdentityId = patient.bookingIdentityId;
      }
    }
  }

  if (args.owner.userId !== undefined) {
    const user = await ctx.db.get("users", args.owner.userId);
    if (!user) {
      if (args.allowsMissingLinkedRecords) {
        return resolvedRefs;
      }
      throw new Error(`User with ID ${args.owner.userId} not found`);
    }
    if (
      !args.allowUnrelatedUserId &&
      !(await userHasPracticeRelation(ctx.db, {
        scope: args.scope,
        userId: args.owner.userId,
      }))
    ) {
      throw new Error("User does not belong to this practice.");
    }
    resolvedRefs.userId = args.owner.userId;
  }

  if (args.owner.bookingIdentityId !== undefined) {
    if (args.allowsMissingLinkedRecords) {
      const bookingIdentity = await ctx.db.get(
        "bookingIdentities",
        args.owner.bookingIdentityId,
      );
      if (bookingIdentity?.practiceId === args.scope.practiceId) {
        resolvedRefs.bookingIdentityId = args.owner.bookingIdentityId;
      }
    } else {
      await requireBookingIdentityInPractice(ctx.db, {
        bookingIdentityId: args.owner.bookingIdentityId,
        scope: args.scope,
      });
      resolvedRefs.bookingIdentityId = args.owner.bookingIdentityId;
    }
  }

  if (args.owner.phoneBookingIdentityId !== undefined) {
    await requirePhoneBookingIdentityInPractice(ctx.db, {
      phoneBookingIdentityId: args.owner.phoneBookingIdentityId,
      scope: args.scope,
    });
    resolvedRefs.phoneBookingIdentityId = args.owner.phoneBookingIdentityId;
  }

  return resolvedRefs;
}

async function validateAppointmentSeriesOwnerRefs(
  ctx: MutationCtx | QueryCtx,
  args: {
    patientId?: Id<"patients">;
    practiceId: Id<"practices">;
    userId?: Id<"users">;
  },
): Promise<void> {
  const scope = await requireTrustedPracticeScope(ctx, args.practiceId);

  if (args.patientId) {
    await requirePatientInPractice(ctx.db, {
      patientId: args.patientId,
      scope,
    });
  }

  if (args.userId) {
    const user = await ctx.db.get("users", args.userId);
    if (!user) {
      throw new Error(`User with ID ${args.userId} not found`);
    }
    if (
      !(await userHasPracticeRelation(ctx.db, {
        scope,
        userId: args.userId,
      }))
    ) {
      throw new Error("User does not belong to this practice.");
    }
  }
}

// Mutation to create a new appointment
export const createAppointment = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    bookingIdentityId: v.optional(v.id("bookingIdentities")),
    calendarResourceColumn: v.optional(calendarResourceColumnValidator),
    end: v.optional(v.string()),
    isNewPatient: v.optional(v.boolean()),
    isSimulation: v.optional(v.boolean()),
    locationId: v.id("locations"),
    patientDateOfBirth: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    phoneBookingIdentityId: v.optional(v.id("phoneBookingIdentities")),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    replacesAppointmentId: v.optional(v.id("appointments")),
    simulationKind: v.optional(appointmentSimulationKindValidator),
    simulationRuleSetId: v.optional(v.id("ruleSets")),
    smiley: v.optional(appointmentSmileyValidator),
    start: v.string(),
    temporaryPatientName: v.optional(v.string()),
    temporaryPatientPhoneNumber: v.optional(v.string()),
    title: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaffForMutation(ctx, args.practiceId);
    await requireManagerForPlannerRuleOverride(ctx, args);
    return await createAppointmentFromTrustedSource(ctx, args);
  },
  returns: v.id("appointments"),
});

export const getAppointmentColor = query({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const appointment = await ctx.db.get("appointments", args.appointmentId);
    if (!appointment) {
      throw new Error("Appointment not found.");
    }
    await requirePracticeStaff(ctx, appointment.practiceId);
    return appointment.color ?? DEFAULT_APPOINTMENT_COLOR;
  },
  returns: appointmentColorValidator,
export const getAppointmentSeriesRestoreSnapshotByRootId = query({
  args: {
    rootAppointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const rootAppointment = await ctx.db.get(
      "appointments",
      args.rootAppointmentId,
    );
    if (!rootAppointment?.seriesId) {
      return null;
    }
    await ensurePracticeAccessForQuery(ctx, rootAppointment.practiceId);

    const series = await getAppointmentSeriesRecord(
      ctx.db,
      rootAppointment.seriesId,
    );
    if (series?.rootAppointmentId !== args.rootAppointmentId) {
      return null;
    }
    const appointments = await getSeriesAppointments(ctx.db, series.seriesId);
    return toAppointmentSeriesRestoreSnapshot({ appointments, series });
  },
  returns: v.union(v.null(), appointmentSeriesRestoreSnapshotValidator),
});

export const getAppointmentSeriesRestoreSnapshotByAppointmentId = query({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const appointment = await ctx.db.get("appointments", args.appointmentId);
    if (!appointment?.seriesId) {
      return null;
    }
    await ensurePracticeAccessForQuery(ctx, appointment.practiceId);

    const series = await getAppointmentSeriesRecord(
      ctx.db,
      appointment.seriesId,
    );
    if (!series) {
      return null;
    }
    const appointments = await getSeriesAppointments(ctx.db, series.seriesId);
    return toAppointmentSeriesRestoreSnapshot({ appointments, series });
  },
  returns: v.union(v.null(), appointmentSeriesRestoreSnapshotValidator),
});

export const restoreAppointmentSeriesSnapshot = mutation({
  args: {
    seriesId: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const storedSnapshot = await ctx.db
      .query("appointmentSeriesRestoreSnapshots")
      .withIndex("by_originalSeriesId", (q) =>
        q.eq("originalSeriesId", args.seriesId),
      )
      .first();
    if (!storedSnapshot) {
      throw appointmentChainError(
        "CHAIN_NOT_FOUND",
        "Kettentermin-Wiederherstellung wurde nicht gefunden.",
      );
    }
    await ensurePracticeAccessForMutation(ctx, storedSnapshot.practiceId);

    const { appointments, series } = storedSnapshot.snapshot;
    if (appointments.length === 0) {
      throw appointmentChainError(
        "CHAIN_RESTORE_EMPTY",
        "Die Kettentermin-Serie enthält keine Termine.",
      );
    }

    const activeSeries = await getAppointmentSeriesRecord(
      ctx.db,
      series.seriesId,
    );
    if (activeSeries) {
      throw appointmentChainError(
        "CHAIN_RESTORE_DUPLICATE",
        "Die Kettentermin-Serie ist bereits vorhanden.",
      );
    }

    const rootSnapshot =
      appointments.find(
        (appointment) =>
          appointment.originalAppointmentId === series.rootAppointmentId,
      ) ??
      appointments.find((appointment) => appointment.seriesStepIndex === 0n);
    if (!rootSnapshot) {
      throw appointmentChainError(
        "CHAIN_RESTORE_ROOT_MISSING",
        "Der Starttermin der Kettentermin-Serie fehlt.",
      );
    }

    const originalAppointmentIds = new Set<Id<"appointments">>();
    for (const appointment of appointments) {
      if (appointment.practiceId !== series.practiceId) {
        throw appointmentChainError(
          "CHAIN_RESTORE_PRACTICE_MISMATCH",
          "Die Kettentermin-Serie enthält Termine aus einer anderen Praxis.",
        );
      }
      if (originalAppointmentIds.has(appointment.originalAppointmentId)) {
        throw appointmentChainError(
          "CHAIN_RESTORE_DUPLICATE_APPOINTMENT",
          "Die Kettentermin-Serie enthält einen Termin mehrfach.",
        );
      }
      originalAppointmentIds.add(appointment.originalAppointmentId);
    }

    for (let index = 0; index < appointments.length; index += 1) {
      const appointment = appointments[index];
      if (!appointment) {
        continue;
      }
      if (appointment.cancelledAt !== undefined) {
        continue;
      }
      const candidate = {
        end: appointment.end,
        locationLineageKey: asLocationLineageKey(
          appointment.locationLineageKey,
        ),
        occupancyScope: appointment.occupancyScope,
        start: appointment.start,
      };
      const conflictsWithSnapshot = appointments.some(
        (otherAppointment, otherIndex) =>
          otherIndex !== index &&
          otherAppointment.cancelledAt === undefined &&
          appointmentOverlapsCandidate(otherAppointment, candidate),
      );
      if (conflictsWithSnapshot) {
        throw appointmentChainError(
          "CHAIN_RESTORE_INTERNAL_CONFLICT",
          "Die gespeicherte Kettentermin-Serie kollidiert mit sich selbst.",
        );
      }

      const conflictingOccupancy = await findConflictingCalendarOccupancy(
        ctx.db,
        {
          candidate,
          ...(appointment.simulationRuleSetId === undefined
            ? {}
            : { draftRuleSetId: appointment.simulationRuleSetId }),
          occupancyView: getOccupancyViewForBookingScope(series.scope),
          practiceId: series.practiceId,
        },
      );
      if (conflictingOccupancy) {
        throw appointmentChainError(
          "CHAIN_RESTORE_OCCUPANCY_CONFLICT",
          "Die Kettentermin-Serie kann nicht wiederhergestellt werden, weil ein gespeicherter Zeitraum bereits belegt ist.",
        );
      }
    }

    const restoredAppointments: {
      appointmentId: Id<"appointments">;
      originalAppointmentId: Id<"appointments">;
    }[] = [];
    let restoredRootAppointmentId: Id<"appointments"> | null = null;

    for (const appointment of appointments) {
      const restoredAppointmentId = await ctx.db.insert("appointments", {
        appointmentTypeLineageKey: appointment.appointmentTypeLineageKey,
        appointmentTypeTitle: appointment.appointmentTypeTitle,
        ...(appointment.bookingIdentityId === undefined
          ? {}
          : { bookingIdentityId: appointment.bookingIdentityId }),
        ...(appointment.cancelledAt === undefined
          ? {}
          : { cancelledAt: appointment.cancelledAt }),
        ...(appointment.cancelledByPhoneBookingIdentityId === undefined
          ? {}
          : {
              cancelledByPhoneBookingIdentityId:
                appointment.cancelledByPhoneBookingIdentityId,
            }),
        ...(appointment.cancelledByUserId === undefined
          ? {}
          : { cancelledByUserId: appointment.cancelledByUserId }),
        createdAt: appointment.createdAt,
        end: appointment.end,
        ...(appointment.isSimulation === undefined
          ? {}
          : { isSimulation: appointment.isSimulation }),
        lastModified: appointment.lastModified,
        locationLineageKey: appointment.locationLineageKey,
        occupancyScope: appointment.occupancyScope,
        ...(appointment.patientId === undefined
          ? {}
          : { patientId: appointment.patientId }),
        ...(appointment.phoneBookingIdentityId === undefined
          ? {}
          : { phoneBookingIdentityId: appointment.phoneBookingIdentityId }),
        practiceId: appointment.practiceId,
        ...(appointment.reassignmentSourceVacationLineageKey === undefined
          ? {}
          : {
              reassignmentSourceVacationLineageKey:
                appointment.reassignmentSourceVacationLineageKey,
            }),
        ...(appointment.replacesAppointmentId === undefined
          ? {}
          : { replacesAppointmentId: appointment.replacesAppointmentId }),
        seriesId: series.seriesId,
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
        ...(appointment.smiley === undefined
          ? {}
          : { smiley: appointment.smiley }),
        start: appointment.start,
        title: appointment.title,
        ...(appointment.userId === undefined
          ? {}
          : { userId: appointment.userId }),
      });

      restoredAppointments.push({
        appointmentId: restoredAppointmentId,
        originalAppointmentId: appointment.originalAppointmentId,
      });
      if (
        appointment.originalAppointmentId === rootSnapshot.originalAppointmentId
      ) {
        restoredRootAppointmentId = restoredAppointmentId;
      }
    }

    if (!restoredRootAppointmentId) {
      throw appointmentChainError(
        "CHAIN_RESTORE_ROOT_MISSING",
        "Der Starttermin der Kettentermin-Serie konnte nicht wiederhergestellt werden.",
      );
    }

    await ctx.db.insert("appointmentSeries", {
      appointmentPlanSnapshot: series.appointmentPlanSnapshot,
      ...(series.bookingIdentityId === undefined
        ? {}
        : { bookingIdentityId: series.bookingIdentityId }),
      createdAt: series.createdAt,
      lastModified: series.lastModified,
      ...(series.patientDateOfBirth === undefined
        ? {}
        : { patientDateOfBirth: series.patientDateOfBirth }),
      ...(series.patientId === undefined
        ? {}
        : { patientId: series.patientId }),
      practiceId: series.practiceId,
      rootAppointmentId: restoredRootAppointmentId,
      rootAppointmentTypeId: series.rootAppointmentTypeId,
      rootAppointmentTypeLineageKey: series.rootAppointmentTypeLineageKey,
      rootDurationMinutes: series.rootDurationMinutes,
      ruleSetIdAtBooking: series.ruleSetIdAtBooking,
      scope: series.scope,
      seriesId: series.seriesId,
      ...(series.userId === undefined ? {} : { userId: series.userId }),
    });
    await ctx.db.delete(
      "appointmentSeriesRestoreSnapshots",
      storedSnapshot._id,
    );

    return {
      appointments: restoredAppointments,
      rootAppointmentId: restoredRootAppointmentId,
      seriesId: series.seriesId,
    };
  },
  returns: appointmentSeriesRestoreResultValidator,
});

export const restoreDeletedAppointment = mutation({
  args: {
    originalAppointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const snapshot = await ctx.db
      .query("appointmentRestoreSnapshots")
      .withIndex("by_originalAppointmentId", (q) =>
        q.eq("originalAppointmentId", args.originalAppointmentId),
      )
      .first();
    if (!snapshot) {
      throw appointmentChainError(
        "CHAIN_NOT_FOUND",
        "Appointment restore snapshot not found",
      );
    }
    await requirePracticeStaffForMutation(ctx, snapshot.practiceId);
    await requireManagerForPlannerRuleOverride(ctx, {
      appointmentTypeId: snapshot.appointmentTypeId,
      locationId: snapshot.locationId,
      ...(snapshot.patientDateOfBirth === undefined
        ? {}
        : { patientDateOfBirth: snapshot.patientDateOfBirth }),
      practiceId: snapshot.practiceId,
      ...(snapshot.practitionerId === undefined
        ? {}
        : { practitionerId: snapshot.practitionerId }),
      start: snapshot.start,
    });
    const restoredAppointmentId = await createAppointmentFromTrustedSource(
      ctx,
      {
        appointmentTypeId: snapshot.appointmentTypeId,
        ...(snapshot.bookingIdentityId === undefined
          ? {}
          : { bookingIdentityId: snapshot.bookingIdentityId }),
        ...(snapshot.calendarResourceColumn === undefined
          ? {}
          : { calendarResourceColumn: snapshot.calendarResourceColumn }),
        ...(snapshot.color === undefined ? {} : { color: snapshot.color }),
        ...(snapshot.end === undefined
          ? {}
          : { allowRestoredEnd: true, end: snapshot.end }),
        ...(snapshot.isNewPatient === undefined
          ? {}
          : { isNewPatient: snapshot.isNewPatient }),
        ...(snapshot.isSimulation === undefined
          ? {}
          : { isSimulation: snapshot.isSimulation }),
        locationId: snapshot.locationId,
        ...(snapshot.patientDateOfBirth === undefined
          ? {}
          : { patientDateOfBirth: snapshot.patientDateOfBirth }),
        ...(snapshot.patientId === undefined
          ? {}
          : { patientId: snapshot.patientId }),
        ...(snapshot.phoneBookingIdentityId === undefined
          ? {}
          : { phoneBookingIdentityId: snapshot.phoneBookingIdentityId }),
        practiceId: snapshot.practiceId,
        ...(snapshot.practitionerId === undefined
          ? {}
          : { practitionerId: snapshot.practitionerId }),
        ...(snapshot.replacesAppointmentId === undefined
          ? {}
          : { replacesAppointmentId: snapshot.replacesAppointmentId }),
        ...(snapshot.simulationKind === undefined
          ? {}
          : { simulationKind: snapshot.simulationKind }),
        ...(snapshot.simulationRuleSetId === undefined
          ? {}
          : { simulationRuleSetId: snapshot.simulationRuleSetId }),
        ...(snapshot.smiley === undefined
          ? {}
          : { allowHistoricalSmiley: true, smiley: snapshot.smiley }),
        start: snapshot.start,
        title: snapshot.title,
        ...(snapshot.userId === undefined ? {} : { userId: snapshot.userId }),
      },
    );
    await ctx.db.delete("appointmentRestoreSnapshots", snapshot._id);
    return restoredAppointmentId;
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
  calendarResourceColumn: v.optional(
    v.union(calendarResourceColumnValidator, v.null()),
  ),
  end: v.optional(v.string()),
  id: v.id("appointments"),
  isSimulation: v.optional(v.boolean()),
  locationId: v.optional(v.id("locations")),
  patientId: v.optional(v.id("patients")),
  practitionerId: v.optional(v.id("practitioners")),
  replacesAppointmentId: v.optional(v.id("appointments")),
  simulationKind: v.optional(appointmentSimulationKindValidator),
  simulationRuleSetId: v.optional(v.id("ruleSets")),
  smiley: v.optional(v.union(appointmentSmileyValidator, v.null())),
  start: v.optional(v.string()),
  title: v.optional(v.string()),
  userId: v.optional(v.id("users")),
} as const;

interface AppointmentUpdateArgs {
  appointmentTypeId?: Id<"appointmentTypes">;
  calendarResourceColumn?: "ekg" | "labor" | null;
  end?: string;
  id: Id<"appointments">;
  isSimulation?: boolean;
  locationId?: Id<"locations">;
  patientId?: Id<"patients">;
  practitionerId?: Id<"practitioners">;
  replacesAppointmentId?: Id<"appointments">;
  simulationKind?: AppointmentSimulationKind;
  simulationRuleSetId?: Id<"ruleSets">;
  smiley?: AppointmentSmiley | null;
  start?: string;
  title?: string;
  userId?: Id<"users">;
}

type AppointmentUpdateData = Omit<AppointmentUpdateArgs, "id">;
type AppointmentUpdateMode = "activationReassignment" | "real" | "simulation";

type PersistedAppointmentUpdateData = Pick<
  AppointmentUpdateData,
  "end" | "patientId" | "start" | "title" | "userId"
>;

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

function compactAppointmentUpdateData(
  updateData: AppointmentUpdateData,
): Partial<AppointmentUpdateData> {
  const compacted: Partial<AppointmentUpdateData> = {};

  if (updateData.appointmentTypeId !== undefined) {
    compacted.appointmentTypeId = updateData.appointmentTypeId;
  }
  if (updateData.calendarResourceColumn !== undefined) {
    compacted.calendarResourceColumn = updateData.calendarResourceColumn;
  }
  if (updateData.end !== undefined) {
    compacted.end = updateData.end;
  }
  if (updateData.isSimulation !== undefined) {
    compacted.isSimulation = updateData.isSimulation;
  }
  if (updateData.locationId !== undefined) {
    compacted.locationId = updateData.locationId;
  }
  if (updateData.patientId !== undefined) {
    compacted.patientId = updateData.patientId;
  }
  if (updateData.practitionerId !== undefined) {
    compacted.practitionerId = updateData.practitionerId;
  }
  if (updateData.replacesAppointmentId !== undefined) {
    compacted.replacesAppointmentId = updateData.replacesAppointmentId;
  }
  if (updateData.simulationKind !== undefined) {
    compacted.simulationKind = updateData.simulationKind;
  }
  if (updateData.simulationRuleSetId !== undefined) {
    compacted.simulationRuleSetId = updateData.simulationRuleSetId;
  }
  if (updateData.smiley !== undefined) {
    compacted.smiley = updateData.smiley;
  }
  if (updateData.start !== undefined) {
    compacted.start = updateData.start;
  }
  if (updateData.title !== undefined) {
    compacted.title = updateData.title;
  }
  if (updateData.userId !== undefined) {
    compacted.userId = updateData.userId;
  }

  return compacted;
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

function isSeriesFollowUpResizeOnlyUpdateData(
  updateData: Partial<AppointmentUpdateData>,
): boolean {
  return (
    updateData.end !== undefined &&
    updateData.appointmentTypeId === undefined &&
    updateData.calendarResourceColumn === undefined &&
    updateData.isSimulation === undefined &&
    updateData.locationId === undefined &&
    updateData.patientId === undefined &&
    updateData.practitionerId === undefined &&
    updateData.replacesAppointmentId === undefined &&
    updateData.simulationKind === undefined &&
    updateData.simulationRuleSetId === undefined &&
    updateData.smiley === undefined &&
    updateData.start === undefined &&
    updateData.title === undefined &&
    updateData.userId === undefined
  );
}

function isSmileyOnlyAppointmentUpdateData(
  updateData: Partial<AppointmentUpdateData>,
): boolean {
  return (
    updateData.smiley !== undefined &&
    updateData.appointmentTypeId === undefined &&
    updateData.calendarResourceColumn === undefined &&
    updateData.end === undefined &&
    updateData.isSimulation === undefined &&
    updateData.locationId === undefined &&
    updateData.patientId === undefined &&
    updateData.practitionerId === undefined &&
    updateData.replacesAppointmentId === undefined &&
    updateData.simulationKind === undefined &&
    updateData.simulationRuleSetId === undefined &&
    updateData.start === undefined &&
    updateData.title === undefined &&
    updateData.userId === undefined
  );
}

function persistedAppointmentUpdateData(
  updateData: Partial<AppointmentUpdateData>,
): Partial<PersistedAppointmentUpdateData> {
  const persisted: Partial<PersistedAppointmentUpdateData> = {};

  if (updateData.end !== undefined) {
    persisted.end = updateData.end;
  }
  if (updateData.patientId !== undefined) {
    persisted.patientId = updateData.patientId;
  }
  if (updateData.start !== undefined) {
    persisted.start = updateData.start;
  }
  if (updateData.title !== undefined) {
    persisted.title = updateData.title;
  }
  if (updateData.userId !== undefined) {
    persisted.userId = updateData.userId;
  }

  return persisted;
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
  await requirePracticeStaffForMutation(ctx, existingAppointment.practiceId);
  const existingPracticeScope = await requireTrustedPracticeScope(
    ctx,
    existingAppointment.practiceId,
  );
  assertExpectedAppointmentUpdateMode(existingAppointment, expectedMode);

  const filteredUpdateData = compactAppointmentUpdateData(updateData);
  assertImmutableAppointmentModeFields(filteredUpdateData);

  const { patientId, userId } = filteredUpdateData;

  if (
    filteredUpdateData.smiley !== undefined &&
    filteredUpdateData.smiley !== null
  ) {
    await requireConfiguredAppointmentSmiley(ctx.db, {
      practiceId: existingAppointment.practiceId,
      ...(existingAppointment.isSimulation === true &&
      existingAppointment.simulationRuleSetId !== undefined
        ? { ruleSetId: existingAppointment.simulationRuleSetId }
        : {}),
      smiley: filteredUpdateData.smiley,
    });
  }

  if (isSmileyOnlyAppointmentUpdateData(filteredUpdateData)) {
    await ctx.db.patch("appointments", id, {
      lastModified: BigInt(Date.now()),
      smiley: filteredUpdateData.smiley ?? undefined,
    });
    return null;
  }

  if (patientId) {
    await requirePatientInPractice(ctx.db, {
      patientId,
      scope: existingPracticeScope,
    });
  }

  if (userId) {
    const user = await ctx.db.get("users", userId);
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    if (
      !(await userHasPracticeRelation(ctx.db, {
        scope: existingPracticeScope,
        userId,
      }))
    ) {
      throw new Error("User does not belong to this practice.");
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
  if (editingRuleSetId !== undefined) {
    const editingRuleSetScope = await requireTrustedRuleSetScope(ctx, {
      practiceId: existingAppointment.practiceId,
      ruleSetId: editingRuleSetId,
    });
    if (filteredUpdateData.appointmentTypeId !== undefined) {
      await requireAppointmentTypeInPracticeRuleSet(ctx.db, {
        appointmentTypeId: filteredUpdateData.appointmentTypeId,
        scope: editingRuleSetScope,
      });
    }
    if (filteredUpdateData.locationId !== undefined) {
      await requireLocationInPracticeRuleSet(ctx.db, {
        locationId: filteredUpdateData.locationId,
        scope: editingRuleSetScope,
      });
    }
    if (filteredUpdateData.practitionerId !== undefined) {
      await requirePractitionerInPracticeRuleSet(ctx.db, {
        practitionerId: filteredUpdateData.practitionerId,
        scope: editingRuleSetScope,
      });
    }
  }
  const existingPractitionerLineageKey = getAppointmentPractitionerLineageKey(
    existingAppointment.occupancyScope,
  );
  const explicitlyUsingResourceColumn =
    filteredUpdateData.calendarResourceColumn !== undefined &&
    filteredUpdateData.calendarResourceColumn !== null;

  const resolvedStoredReferences: StoredAppointmentReferences =
    filteredUpdateData.appointmentTypeId !== undefined ||
    filteredUpdateData.locationId !== undefined ||
    filteredUpdateData.practitionerId !== undefined ||
    explicitlyUsingResourceColumn
      ? await (async () => {
          if (
            explicitlyUsingResourceColumn &&
            filteredUpdateData.appointmentTypeId === undefined &&
            filteredUpdateData.locationId === undefined &&
            filteredUpdateData.practitionerId === undefined
          ) {
            return {
              appointmentTypeLineageKey: asAppointmentTypeLineageKey(
                existingAppointment.appointmentTypeLineageKey,
              ),
              locationLineageKey: asLocationLineageKey(
                existingAppointment.locationLineageKey,
              ),
            };
          }
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
          const practitionerIdForWrite = explicitlyUsingResourceColumn
            ? undefined
            : (filteredUpdateData.practitionerId ??
              (existingPractitionerLineageKey
                ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
                    lineageKey: asPractitionerLineageKey(
                      existingPractitionerLineageKey,
                    ),
                    ruleSetId: editingRuleSetId,
                  })
                : undefined));

          return resolveStoredAppointmentReferencesForWrite(ctx.db, {
            appointmentTypeId: asAppointmentTypeId(appointmentTypeIdForWrite),
            locationId: asLocationId(locationIdForWrite),
            ...(practitionerIdForWrite
              ? { practitionerId: asPractitionerId(practitionerIdForWrite) }
              : {}),
          });
        })()
      : {
          appointmentTypeLineageKey: asAppointmentTypeLineageKey(
            existingAppointment.appointmentTypeLineageKey,
          ),
          locationLineageKey: asLocationLineageKey(
            existingAppointment.locationLineageKey,
          ),
          ...(existingPractitionerLineageKey
            ? {
                practitionerLineageKey: asPractitionerLineageKey(
                  existingPractitionerLineageKey,
                ),
              }
            : {}),
        };
  const resolvedAppointmentTypeRecord =
    filteredUpdateData.appointmentTypeId === undefined
      ? editingRuleSetId === undefined
        ? undefined
        : await (async () => {
            const appointmentTypeIdForWrite =
              await resolveAppointmentTypeIdForRuleSetByLineage(ctx.db, {
                lineageKey: asAppointmentTypeLineageKey(
                  existingAppointment.appointmentTypeLineageKey,
                ),
                ruleSetId: editingRuleSetId,
              });
            return requireEntityUsableForNewAppointment({
              entity: await ctx.db.get(
                "appointmentTypes",
                appointmentTypeIdForWrite,
              ),
              entityId: appointmentTypeIdForWrite,
              entityLabel: "Terminart",
            });
          })()
      : requireEntityUsableForNewAppointment({
          entity: appointmentTypeRecord,
          entityId: filteredUpdateData.appointmentTypeId,
          entityLabel: "Terminart",
        });
  const explicitCalendarResourceColumn =
    filteredUpdateData.calendarResourceColumn === undefined
      ? undefined
      : (filteredUpdateData.calendarResourceColumn ?? undefined);
  const fallbackCalendarResourceColumn =
    filteredUpdateData.calendarResourceColumn === undefined &&
    filteredUpdateData.practitionerId === undefined
      ? getAppointmentCalendarResourceColumn(existingAppointment.occupancyScope)
      : undefined;
  const resolvedAppointmentTypeLineageKey =
    resolvedStoredReferences.appointmentTypeLineageKey;
  const resolvedLocationLineageKey =
    resolvedStoredReferences.locationLineageKey;
  const resolvedOccupancyScope =
    resolvedAppointmentTypeRecord === undefined
      ? appointmentOccupancyScopeFromRefs({
          ...((explicitCalendarResourceColumn ??
            fallbackCalendarResourceColumn) === undefined
            ? {}
            : {
                calendarResourceColumn:
                  explicitCalendarResourceColumn ??
                  fallbackCalendarResourceColumn,
              }),
          ...(resolvedStoredReferences.practitionerLineageKey === undefined
            ? {}
            : {
                practitionerLineageKey:
                  resolvedStoredReferences.practitionerLineageKey,
              }),
        })
      : resolveSingleAppointmentOccupancy({
          appointmentType: resolvedAppointmentTypeRecord,
          ...(explicitCalendarResourceColumn === undefined
            ? {}
            : { calendarResourceColumn: explicitCalendarResourceColumn }),
          storedReferences: resolvedStoredReferences,
        });
  const resolvedPractitionerLineageKey = getAppointmentPractitionerLineageKey(
    resolvedOccupancyScope,
  );
  const resolvedCalendarResourceColumn = getAppointmentCalendarResourceColumn(
    resolvedOccupancyScope,
  );
  const resolvedStart = filteredUpdateData.start ?? existingAppointment.start;
  const resolvedEnd = filteredUpdateData.end ?? existingAppointment.end;
  const resolvedIsSimulation = existingAppointment.isSimulation;
  const resolvedSimulationRuleSetId = existingAppointment.simulationRuleSetId;

  if (
    filteredUpdateData.appointmentTypeId !== undefined ||
    (filteredUpdateData.practitionerId !== undefined &&
      !explicitlyUsingResourceColumn)
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
    const activeAppointmentTypeScope = await requireTrustedRuleSetScope(ctx, {
      practiceId: existingAppointment.practiceId,
      ruleSetId: activeAppointmentType.ruleSetId,
    });
    await requireAppointmentTypeInPracticeRuleSet(ctx.db, {
      appointmentTypeId: appointmentTypeIdForValidation,
      scope: activeAppointmentTypeScope,
    });

    const practitionerIdForValidation = explicitlyUsingResourceColumn
      ? undefined
      : (filteredUpdateData.practitionerId ??
        (existingPractitionerLineageKey
          ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
              lineageKey: asPractitionerLineageKey(
                existingPractitionerLineageKey,
              ),
              ruleSetId: activeAppointmentType.ruleSetId,
            })
          : undefined));

    if (
      practitionerIdForValidation &&
      !activeAppointmentType.allowedPractitionerLineageKeys.includes(
        await requirePractitionerInPracticeRuleSet(ctx.db, {
          practitionerId: practitionerIdForValidation,
          scope: activeAppointmentTypeScope,
        }).then((practitioner) =>
          asPractitionerLineageKey(practitioner.lineageKey ?? practitioner._id),
        ),
      )
    ) {
      throw new Error(
        "Der gewählte Behandler ist für diese Terminart nicht freigegeben.",
      );
    }
  }

  const hasSchedulingChange =
    resolvedLocationLineageKey !== existingAppointment.locationLineageKey ||
    resolvedPractitionerLineageKey !==
      getAppointmentPractitionerLineageKey(
        existingAppointment.occupancyScope,
      ) ||
    resolvedCalendarResourceColumn !==
      getAppointmentCalendarResourceColumn(
        existingAppointment.occupancyScope,
      ) ||
    resolvedStart !== existingAppointment.start ||
    resolvedEnd !== existingAppointment.end;

  const hasPlannerRuleRelevantAppointmentTypeChange =
    resolvedAppointmentTypeLineageKey !==
    existingAppointment.appointmentTypeLineageKey;

  if (
    hasPlannerRuleRelevantAppointmentTypeChange &&
    filteredUpdateData.appointmentTypeId !== undefined
  ) {
    const plannerRuleSetId = appointmentTypeRecord?.ruleSetId;
    if (plannerRuleSetId === undefined) {
      throw new Error("Die Terminart konnte nicht validiert werden.");
    }
    const plannerLocationId =
      filteredUpdateData.locationId ??
      (await resolveLocationIdForRuleSetByLineage(ctx.db, {
        lineageKey: resolvedLocationLineageKey,
        ruleSetId: plannerRuleSetId,
      }));
    const plannerPractitionerId =
      resolvedCalendarResourceColumn === undefined &&
      resolvedPractitionerLineageKey !== undefined
        ? (filteredUpdateData.practitionerId ??
          (await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
            lineageKey: asPractitionerLineageKey(
              resolvedPractitionerLineageKey,
            ),
            ruleSetId: plannerRuleSetId,
          })))
        : undefined;
    await requireManagerForPlannerRuleOverride(ctx, {
      appointmentTypeId: filteredUpdateData.appointmentTypeId,
      locationId: plannerLocationId,
      practiceId: existingAppointment.practiceId,
      ...(plannerPractitionerId === undefined
        ? {}
        : { practitionerId: plannerPractitionerId }),
      start: resolvedStart,
    });
  }

  if (hasSchedulingChange) {
    await requirePracticeManagerForMutation(
      ctx,
      existingAppointment.practiceId,
    );
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
      if (isSeriesFollowUpResizeOnlyUpdateData(filteredUpdateData)) {
        if (filteredUpdateData.end === undefined) {
          throw appointmentChainError(
            "CHAIN_NON_ROOT_UPDATE_FORBIDDEN",
            "Folgetermine können nur in der Länge angepasst werden.",
          );
        }

        const resizedEnd = asZonedDateTimeString(filteredUpdateData.end);
        calculateDurationMinutes(
          resizedEnd,
          asZonedDateTimeString(existingAppointment.start),
        );

        const conflictingOccupancy = await findConflictingCalendarOccupancy(
          ctx.db,
          {
            candidate: {
              end: resizedEnd,
              locationLineageKey: resolvedLocationLineageKey,
              occupancyScope: resolvedOccupancyScope,
              start: resolvedStart,
            },
            practiceId: existingAppointment.practiceId,
            ...(resolvedIsSimulation === true && resolvedSimulationRuleSetId
              ? { draftRuleSetId: resolvedSimulationRuleSetId }
              : {}),
            excludeAppointmentIds: [existingAppointment._id],
            occupancyView: getOccupancyViewForBookingScope(
              getAppointmentBookingScope(resolvedIsSimulation),
            ),
          },
        );

        if (conflictingOccupancy) {
          throw new Error("Der gewaehlte Zeitraum ist bereits belegt.");
        }

        const seriesRecord = await getAppointmentSeriesRecord(ctx.db, seriesId);
        if (!seriesRecord) {
          throw appointmentChainError(
            "CHAIN_NOT_FOUND",
            "Die gespeicherte Kettentermin-Serie wurde nicht gefunden.",
          );
        }

        const now = BigInt(Date.now());
        await ctx.db.patch("appointments", id, {
          ...getPersistentSimulationFields(existingAppointment, now),
          end: resizedEnd,
          lastModified: now,
        });
        await ctx.db.patch("appointmentSeries", seriesRecord._id, {
          lastModified: now,
        });
        return null;
      }

      throw appointmentChainError(
        "CHAIN_NON_ROOT_UPDATE_FORBIDDEN",
        "Folgetermine können nicht einzeln bearbeitet werden. Bitte den Starttermin bearbeiten.",
      );
    }

    if (filteredUpdateData.calendarResourceColumn !== undefined) {
      const existingCalendarResourceColumn =
        getAppointmentCalendarResourceColumn(
          existingAppointment.occupancyScope,
        );
      const requestedCalendarResourceColumn =
        filteredUpdateData.calendarResourceColumn ?? undefined;
      const changesCalendarResourceColumn =
        existingCalendarResourceColumn === undefined ||
        requestedCalendarResourceColumn === undefined ||
        requestedCalendarResourceColumn !== existingCalendarResourceColumn;
      if (changesCalendarResourceColumn) {
        throw appointmentChainError(
          "CHAIN_REPLAN_FAILED",
          "Kettentermine können nicht in EKG- oder Labor-Spalten verschoben werden.",
        );
      }
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
      (existingPractitionerLineageKey
        ? await resolvePractitionerIdForRuleSetByLineage(ctx.db, {
            lineageKey: asPractitionerLineageKey(
              existingPractitionerLineageKey,
            ),
            ruleSetId: seriesRecord.ruleSetIdAtBooking,
          })
        : undefined);
    const rootOccupancy: SeriesRootOccupancy = {
      ...(resolvedCalendarResourceColumn !== undefined && {
        calendarResourceColumn: resolvedCalendarResourceColumn,
      }),
      occupancyScope: resolvedOccupancyScope,
      ...(practitionerId !== undefined && { practitionerId }),
    };

    const plannedSteps = await replanAppointmentSeries(ctx, {
      ...(resolvedCalendarResourceColumn !== undefined && {
        calendarResourceColumn: resolvedCalendarResourceColumn,
      }),
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
      ...(practitionerId !== undefined && { practitionerId }),
      rootDurationMinutes: calculateDurationMinutes(updatedEnd, updatedStart),
      rootOccupancy,
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
    const resolvedRootSmiley =
      filteredUpdateData.smiley === undefined
        ? existingAppointment.smiley
        : (filteredUpdateData.smiley ?? undefined);
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
      const stepSmiley =
        step.seriesStepIndex === 0
          ? resolvedRootSmiley
          : matchingAppointment?.smiley;
      const title =
        step.seriesStepIndex === 0
          ? (filteredUpdateData.title?.trim() ?? existingAppointment.title)
          : `Folgetermin: ${step.appointmentTypeTitle}`;

      if (matchingAppointment) {
        const stepStoredReferences =
          await resolveStoredAppointmentReferencesForWrite(ctx.db, {
            appointmentTypeId: asAppointmentTypeId(step.appointmentTypeId),
            locationId: asLocationId(step.locationId),
            ...(step.practitionerId
              ? { practitionerId: asPractitionerId(step.practitionerId) }
              : {}),
          });
        await ctx.db.patch("appointments", matchingAppointment._id, {
          appointmentTypeLineageKey:
            stepStoredReferences.appointmentTypeLineageKey,
          ...persistentSimulationFields,
          appointmentTypeTitle: step.appointmentTypeTitle,
          end: step.end,
          lastModified: now,
          locationLineageKey: stepStoredReferences.locationLineageKey,
          occupancyScope: step.occupancyScope,
          ...(resolvedPatientId && { patientId: resolvedPatientId }),
          seriesId,
          seriesStepId: step.stepId,
          seriesStepIndex: BigInt(step.seriesStepIndex),
          ...(step.seriesStepIndex === 0 || stepSmiley !== undefined
            ? { smiley: stepSmiley }
            : {}),
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
          ...(step.practitionerId
            ? { practitionerId: asPractitionerId(step.practitionerId) }
            : {}),
        });
      const stepAppointmentType = await ctx.db.get(
        "appointmentTypes",
        step.appointmentTypeId,
      );
      if (!stepAppointmentType) {
        throw new Error("Terminart fuer Kettentermin nicht gefunden.");
      }
      const insertedAppointmentId = await ctx.db.insert("appointments", {
        appointmentTypeLineageKey:
          stepStoredReferences.appointmentTypeLineageKey,
        ...persistentSimulationFields,
        appointmentTypeTitle: step.appointmentTypeTitle,
        ...((seriesRecord.bookingIdentityId ??
        existingAppointment.bookingIdentityId)
          ? {
              bookingIdentityId:
                seriesRecord.bookingIdentityId ??
                existingAppointment.bookingIdentityId,
            }
          : {}),
        color: await resolveAppointmentColorForType(
          ctx.db,
          stepAppointmentType,
        ),
        createdAt: now,
        end: step.end,
        lastModified: now,
        locationLineageKey: stepStoredReferences.locationLineageKey,
        occupancyScope: step.occupancyScope,
        ...(resolvedPatientId && { patientId: resolvedPatientId }),
        practiceId: existingAppointment.practiceId,
        seriesId,
        seriesStepId: step.stepId,
        seriesStepIndex: BigInt(step.seriesStepIndex),
        ...(stepSmiley === undefined ? {} : { smiley: stepSmiley }),
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
      ...((seriesRecord.bookingIdentityId ??
      existingAppointment.bookingIdentityId)
        ? {
            bookingIdentityId:
              seriesRecord.bookingIdentityId ??
              existingAppointment.bookingIdentityId,
          }
        : {}),
      appointmentPlanSnapshot: seriesRecord.appointmentPlanSnapshot,
      createdAt: seriesRecord.createdAt,
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

  const persistedUpdateData =
    persistedAppointmentUpdateData(filteredUpdateData);

  if (hasSchedulingChange) {
    const appointmentBookingScope =
      getAppointmentBookingScope(resolvedIsSimulation);
    const conflictingOccupancy = await findConflictingCalendarOccupancy(
      ctx.db,
      {
        candidate: {
          end: resolvedEnd,
          locationLineageKey: resolvedLocationLineageKey,
          occupancyScope: resolvedOccupancyScope,
          start: resolvedStart,
        },
        practiceId: existingAppointment.practiceId,
        ...(resolvedIsSimulation === true && resolvedSimulationRuleSetId
          ? { draftRuleSetId: resolvedSimulationRuleSetId }
          : {}),
        excludeAppointmentIds: [existingAppointment._id],
        occupancyView: getOccupancyViewForBookingScope(appointmentBookingScope),
      },
    );

    if (conflictingOccupancy) {
      throw new Error("Der gewaehlte Zeitraum ist bereits belegt.");
    }
  }

  await ctx.db.patch("appointments", id, {
    ...persistedUpdateData,
    ...(filteredUpdateData.smiley === undefined
      ? {}
      : { smiley: filteredUpdateData.smiley ?? undefined }),
    ...getPersistentSimulationFields(existingAppointment, BigInt(Date.now())),
    appointmentTypeLineageKey: resolvedAppointmentTypeLineageKey,
    lastModified: BigInt(Date.now()),
    locationLineageKey: resolvedLocationLineageKey,
    occupancyScope: resolvedOccupancyScope,
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

export const updateAppointmentSmiley = mutation({
  args: {
    id: v.id("appointments"),
    smiley: v.union(appointmentSmileyValidator, v.null()),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const existingAppointment = await ctx.db.get("appointments", args.id);
    if (!existingAppointment) {
      throw appointmentChainError("CHAIN_NOT_FOUND", "Appointment not found");
    }
    await requirePracticeStaffForMutation(ctx, existingAppointment.practiceId);
    if (args.smiley !== null) {
      await requireConfiguredAppointmentSmiley(ctx.db, {
        practiceId: existingAppointment.practiceId,
        smiley: args.smiley,
      });
    }

    await ctx.db.patch("appointments", args.id, {
      lastModified: BigInt(Date.now()),
      smiley: args.smiley ?? undefined,
    });
    return null;
  },
  returns: v.null(),
});

export const updateSimulationAppointmentSmiley = mutation({
  args: {
    id: v.id("appointments"),
    simulationRuleSetId: v.id("ruleSets"),
    smiley: v.union(appointmentSmileyValidator, v.null()),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const existingAppointment = await ctx.db.get("appointments", args.id);
    if (!existingAppointment) {
      throw appointmentChainError("CHAIN_NOT_FOUND", "Appointment not found");
    }
    await requirePracticeStaffForMutation(ctx, existingAppointment.practiceId);
    const smileyOptions = await getConfiguredAppointmentSmileyOptions(ctx.db, {
      practiceId: existingAppointment.practiceId,
      ruleSetId: args.simulationRuleSetId,
    });
    if (
      args.smiley !== null &&
      !smileyOptions.some((option) => option.emoji === args.smiley)
    ) {
      throw new Error(
        "Der gewählte Termin-Smiley ist für diese Praxis nicht konfiguriert.",
      );
    }

    const now = BigInt(Date.now());
    if (existingAppointment.isSimulation === true) {
      if (
        existingAppointment.simulationRuleSetId !== args.simulationRuleSetId
      ) {
        throw new Error("Simulation appointment belongs to another rule set");
      }
      const replacementSmiley = args.smiley ?? undefined;
      if (existingAppointment.replacesAppointmentId !== undefined) {
        const realAppointment = await ctx.db.get(
          "appointments",
          existingAppointment.replacesAppointmentId,
        );
        if (
          realAppointment &&
          simulationReplacementMatchesRealAppointment(
            existingAppointment,
            realAppointment,
            replacementSmiley,
          )
        ) {
          await ctx.db.delete("appointments", args.id);
          return null;
        }
      }
      await ctx.db.patch("appointments", args.id, {
        lastModified: now,
        smiley: replacementSmiley,
      });
      return null;
    }

    const existingReplacementsForAppointment = await ctx.db
      .query("appointments")
      .withIndex("by_replacesAppointmentId", (q) =>
        q.eq("replacesAppointmentId", args.id),
      )
      .collect();
    const replacement = existingReplacementsForAppointment.find(
      (appointment) =>
        appointment.isSimulation === true &&
        appointment.simulationRuleSetId === args.simulationRuleSetId,
    );
    if (replacement) {
      const replacementSmiley = args.smiley ?? undefined;
      if (
        simulationReplacementMatchesRealAppointment(
          replacement,
          existingAppointment,
          replacementSmiley,
        )
      ) {
        await ctx.db.delete("appointments", replacement._id);
        return null;
      }
      await ctx.db.patch("appointments", replacement._id, {
        lastModified: now,
        smiley: replacementSmiley,
      });
      return null;
    }

    const requestedSmiley = args.smiley ?? undefined;
    if (requestedSmiley === existingAppointment.smiley) {
      return null;
    }

    await ctx.db.insert("appointments", {
      ...appointmentReplacementInsertFields(existingAppointment, {
        smiley: requestedSmiley,
      }),
      createdAt: now,
      isSimulation: true,
      lastModified: now,
      replacesAppointmentId: args.id,
      simulationKind: "draft",
      simulationRuleSetId: args.simulationRuleSetId,
      simulationValidatedAt: now,
    });
    return null;
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
    await requirePracticeStaffForMutation(ctx, existingAppointment.practiceId);

    if (existingAppointment.seriesId !== undefined) {
      const seriesId = existingAppointment.seriesId;
      if (!seriesId) {
        throw appointmentChainError(
          "CHAIN_NOT_FOUND",
          "Appointment series metadata is incomplete.",
        );
      }
      const seriesAppointments = await getSeriesAppointments(ctx.db, seriesId);
      const seriesRecord = await getAppointmentSeriesRecord(ctx.db, seriesId);
      if (seriesRecord) {
        await saveAppointmentSeriesRestoreSnapshot(ctx, {
          appointments: seriesAppointments,
          deletedAt: BigInt(Date.now()),
          series: seriesRecord,
        });
      }
      for (const seriesAppointment of seriesAppointments) {
        await ctx.db.delete("appointments", seriesAppointment._id);
      }
      if (seriesRecord) {
        await ctx.db.delete("appointmentSeries", seriesRecord._id);
      }
      return null;
    }

    const now = BigInt(Date.now());
    await saveAppointmentRestoreSnapshot(ctx, existingAppointment, now);
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
    activeRuleSetId: v.id("ruleSets"),
    refreshNonce: v.optional(v.number()),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    return await getBookedAppointmentsForUser(ctx, args);
  },
  returns: v.array(bookedAppointmentSummaryItemValidator),
});

export const getBookedAppointmentsForCurrentUserInActivePractice = query({
  args: {
    practiceId: v.id("practices"),
    refreshNonce: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const activeRuleSetId = await requireActiveRuleSetIdForPractice(
      ctx.db,
      args.practiceId,
    );
    return await getBookedAppointmentsForUser(ctx, {
      activeRuleSetId,
      ...(args.refreshNonce === undefined
        ? {}
        : { refreshNonce: args.refreshNonce }),
    });
  },
  returns: v.array(bookedAppointmentSummaryItemValidator),
});

// Query to get the authenticated user's next booked appointment (future only)
export const getBookedAppointmentForCurrentUser = query({
  args: {
    activeRuleSetId: v.id("ruleSets"),
    refreshNonce: v.optional(v.number()),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    const appointments = await getBookedAppointmentsForUser(ctx, args);
    return appointments[0] ?? null;
  },
  returns: v.union(bookedAppointmentSummaryItemValidator, v.null()),
});

async function getBookedAppointmentsForUser(
  ctx: QueryCtx,
  args: {
    activeRuleSetId: Id<"ruleSets">;
    refreshNonce?: number;
    selectedRuleSetId?: Id<"ruleSets">;
  },
): Promise<BookedAppointmentSummaryItem[]> {
  const userId = await requireAuthenticatedUserIdForQuery(ctx);

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

  const appointments: AppointmentDoc[] = [];
  for await (const appointment of appointmentQuery) {
    if (
      appointment.isSimulation !== true &&
      isVisibleAppointment(appointment) &&
      isAppointmentInFuture(appointment, nowEpochMilliseconds)
    ) {
      appointments.push(appointment);
    }
  }

  const displayScope = await requireAppointmentDisplayScope(ctx.db, args);
  const scopedUserAppointments = appointments.filter(
    (appointment) => appointment.practiceId === displayScope.practiceId,
  );
  const displayRuleSetId = getDisplayRuleSetIdFromScope(displayScope);
  const legacyHoldScope = getLegacyHoldScopeForDisplayScope(displayScope);
  if (displayRuleSetId) {
    const remappedAppointments = await remapAppointmentIds(
      ctx,
      scopedUserAppointments,
      displayRuleSetId,
    );
    const unresolvedFutureHolds =
      await getFutureLegacyUnmatchedBookingHoldsForUser(ctx, {
        scope: legacyHoldScope,
        userId,
      });
    return [
      ...remappedAppointments.map((appointment) =>
        toBookedAppointmentSummaryItem(appointment),
      ),
      ...unresolvedFutureHolds.map((hold) =>
        toLegacyUnmatchedFutureBookingHoldSummary(hold),
      ),
    ].toSorted((left, right) => left.start.localeCompare(right.start));
  }

  const unresolvedFutureHolds =
    await getFutureLegacyUnmatchedBookingHoldsForUser(ctx, {
      scope: legacyHoldScope,
      userId,
    });
  return [
    ...scopedUserAppointments.map((appointment) =>
      toBookedAppointmentSummaryItem(toAppointmentListItem(appointment)),
    ),
    ...unresolvedFutureHolds.map((hold) =>
      toLegacyUnmatchedFutureBookingHoldSummary(hold),
    ),
  ].toSorted((left, right) => left.start.localeCompare(right.start));
}

// Query to get all appointments for a patient (past, present, and future)
export const getAppointmentsForPatient = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const currentUserId = await requireAuthenticatedUserIdForQuery(ctx);
    const isCurrentUserSelfServiceRead =
      args.userId === currentUserId && args.patientId === undefined;
    if (!isCurrentUserSelfServiceRead) {
      await requirePracticeStaff(ctx, args.practiceId);
    }
    await requireDisplayRuleSetArgsBelongToPractice(ctx, args);
    // Need at least one patient ID
    if (!args.patientId && !args.userId) {
      return [];
    }

    const appointments: AppointmentListItem[] = [];

    // Query by patient ID if provided
    if (args.patientId) {
      const patientId = args.patientId;
      const patient = await ctx.db.get("patients", patientId);
      if (patient?.practiceId !== args.practiceId) {
        return [];
      }
      const patientAppointments = await ctx.db
        .query("appointments")
        .withIndex("by_patientId", (q) => q.eq("patientId", patientId))
        .collect();
      appointments.push(
        ...patientAppointments.map((appointment) =>
          toAppointmentListItem(appointment),
        ),
      );

      if (patient.recordType === "pvs") {
        const activeAssociations = await ctx.db
          .query("bookingIdentityPatientAssociations")
          .withIndex("by_patientId_status", (q) =>
            q.eq("patientId", patientId).eq("status", "active"),
          )
          .collect();
        const associatedAppointments = await Promise.all(
          activeAssociations.map((association) =>
            ctx.db
              .query("appointments")
              .withIndex("by_bookingIdentityId", (q) =>
                q.eq("bookingIdentityId", association.bookingIdentityId),
              )
              .collect(),
          ),
        );
        appointments.push(
          ...associatedAppointments
            .flat()
            .map((appointment) => toAppointmentListItem(appointment)),
        );
      }
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
    ].filter((appointment) => appointment.practiceId === args.practiceId);

    const scope: AppointmentScope = args.scope ?? "real";
    const scopedAppointments = filterAppointmentsForVisibleScope(
      uniqueAppointments,
      args,
      scope,
    );

    if (scope === "simulation") {
      return combineForSimulationScope(scopedAppointments);
    }

    return scopedAppointments.toSorted((a, b) =>
      a.start.localeCompare(b.start),
    );
  },
  returns: v.array(appointmentResultValidator),
});

async function deleteAllSimulatedAppointmentsForPractice(
  db: MutationCtx["db"],
  practiceId: Id<"practices">,
): Promise<number> {
  const simulatedAppointments = await db
    .query("appointments")
    .withIndex("by_practiceId_isSimulation", (q) =>
      q.eq("practiceId", practiceId).eq("isSimulation", true),
    )
    .collect();

  let deleted = 0;
  for (const appointment of simulatedAppointments) {
    if (isActivationBoundSimulation(appointment)) {
      continue;
    }
    await db.delete("appointments", appointment._id);
    deleted += 1;
  }

  return deleted;
}

// Query to get all blocked slots
export const getBlockedSlots = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    practiceId: v.id("practices"),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    await requireDisplayRuleSetArgsBelongToPractice(ctx, args);
    const scope: AppointmentScope = args.scope ?? "real";

    const blockedSlots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_practiceId_start", (q) =>
        q.eq("practiceId", args.practiceId),
      )
      .collect();

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

    return await mapBlockedSlotsForDisplay(
      ctx.db,
      resultSlots,
      getDisplayRuleSetId(args),
    );
  },
  returns: v.array(blockedSlotListItemValidator),
});

export const getBlockedSlotsInRange = query({
  args: {
    activeRuleSetId: v.optional(v.id("ruleSets")),
    end: v.string(),
    practiceId: v.id("practices"),
    scope: v.optional(
      v.union(v.literal("real"), v.literal("simulation"), v.literal("all")),
    ),
    selectedRuleSetId: v.optional(v.id("ruleSets")),
    start: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    await requireDisplayRuleSetArgsBelongToPractice(ctx, args);
    const rangeOverlapBounds = getRangeOverlapBounds(args);
    const rangeBlockedSlots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", rangeOverlapBounds.queryStartInclusive)
          .lt("start", rangeOverlapBounds.queryEndExclusive),
      )
      .collect();
    const blockedSlots = rangeBlockedSlots.filter((blockedSlot) =>
      isTimeRangeOverlap(blockedSlot, args),
    );

    const scope: AppointmentScope = args.scope ?? "real";
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

    return await mapBlockedSlotsForDisplay(
      ctx.db,
      resultSlots.toSorted((left, right) =>
        left.start.localeCompare(right.start),
      ),
      getDisplayRuleSetId(args),
    );
  },
  returns: v.array(blockedSlotListItemValidator),
});

export const getCalendarDayBlockedSlots = query({
  args: calendarDayQueryArgsValidator,
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeStaff(ctx, args.practiceId);
    await requireDisplayRuleSetArgsBelongToPractice(ctx, args);

    const scope: AppointmentScope = args.scope ?? "real";
    const selectedLocationLineageKey = await getOptionalLocationLineageKey(
      ctx.db,
      args.locationId,
    );
    const blockedSlots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_practiceId_start", (q) =>
        q
          .eq("practiceId", args.practiceId)
          .gte("start", args.dayStart)
          .lt("start", args.dayEnd),
      )
      .collect();
    const visibleBlockedSlots = filterBlockedSlotsForCalendarDay(blockedSlots, {
      dayEnd: args.dayEnd,
      dayStart: args.dayStart,
      selectedLocationLineageKey,
    });

    let resultSlots: BlockedSlotDoc[];
    if (scope === "simulation") {
      const replacementBlockedSlots =
        await getSimulationBlockedSlotReplacements(
          ctx,
          args.practiceId,
          visibleBlockedSlots
            .filter((blockedSlot) => blockedSlot.isSimulation !== true)
            .map((blockedSlot) => blockedSlot._id),
        );
      const candidateBlockedSlots = dedupeById([
        ...visibleBlockedSlots,
        ...replacementBlockedSlots,
      ]);
      resultSlots = filterBlockedSlotsForCalendarDay(
        combineBlockedSlotsForSimulation(candidateBlockedSlots),
        {
          dayEnd: args.dayEnd,
          dayStart: args.dayStart,
          selectedLocationLineageKey,
        },
      );
    } else if (scope === "real") {
      resultSlots = visibleBlockedSlots.filter(
        (blockedSlot) => blockedSlot.isSimulation !== true,
      );
    } else {
      resultSlots = visibleBlockedSlots;
    }

    return await mapBlockedSlotsForDisplay(
      ctx.db,
      resultSlots.toSorted((left, right) =>
        left.start.localeCompare(right.start),
      ),
      getDisplayRuleSetId(args),
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
    occupancyScope: blockedSlotMutationOccupancyScopeValidator,
    practiceId: v.id("practices"),
    replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
    start: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await requirePracticeManagerForMutation(ctx, args.practiceId);
    const practiceScope = await requireTrustedPracticeScope(
      ctx,
      args.practiceId,
    );
    const { isSimulation, replacesBlockedSlotId, ...rest } = args;

    if (replacesBlockedSlotId && isSimulation !== true) {
      throw new Error(
        "replacesBlockedSlotId can only be used with isSimulation=true",
      );
    }

    const location = await requireLocationInPractice(ctx.db, {
      locationId: rest.locationId,
      scope: practiceScope,
    });
    const locationLineageKey = asLocationLineageKey(
      location.lineageKey ?? location._id,
    );
    const occupancyScope =
      rest.occupancyScope.kind === "resource"
        ? {
            calendarResourceColumn: rest.occupancyScope.calendarResourceColumn,
            kind: "resource" as const,
          }
        : {
            kind: "practitioner" as const,
            practitionerLineageKey: await requirePractitionerInPractice(
              ctx.db,
              {
                practitionerId: rest.occupancyScope.practitionerId,
                scope: practiceScope,
              },
            ).then((practitioner) =>
              asPractitionerLineageKey(
                practitioner.lineageKey ?? practitioner._id,
              ),
            ),
          };

    const id = await ctx.db.insert("blockedSlots", {
      createdAt: BigInt(Date.now()),
      end: rest.end,
      isSimulation: isSimulation ?? false,
      lastModified: BigInt(Date.now()),
      locationLineageKey,
      occupancyScope,
      practiceId: rest.practiceId,
      start: rest.start,
      title: rest.title,
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
    occupancyScope: v.optional(blockedSlotMutationOccupancyScopeValidator),
    replacesBlockedSlotId: v.optional(v.id("blockedSlots")),
    start: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    const { id, locationId, occupancyScope, ...updates } = args;
    const existingBlockedSlot = await ctx.db.get("blockedSlots", id);
    if (!existingBlockedSlot) {
      throw new Error("Blocked slot not found");
    }
    await requirePracticeManagerForMutation(
      ctx,
      existingBlockedSlot.practiceId,
    );
    const practiceScope = await requireTrustedPracticeScope(
      ctx,
      existingBlockedSlot.practiceId,
    );

    const updatedReferences =
      locationId !== undefined || occupancyScope !== undefined
        ? {
            locationLineageKey:
              locationId === undefined
                ? existingBlockedSlot.locationLineageKey
                : await requireLocationInPractice(ctx.db, {
                    locationId,
                    scope: practiceScope,
                  }).then((location) =>
                    asLocationLineageKey(location.lineageKey ?? location._id),
                  ),
            occupancyScope:
              occupancyScope === undefined
                ? existingBlockedSlot.occupancyScope
                : occupancyScope.kind === "resource"
                  ? {
                      calendarResourceColumn:
                        occupancyScope.calendarResourceColumn,
                      kind: "resource" as const,
                    }
                  : {
                      kind: "practitioner" as const,
                      practitionerLineageKey:
                        await requirePractitionerInPractice(ctx.db, {
                          practitionerId: occupancyScope.practitionerId,
                          scope: practiceScope,
                        }).then((practitioner) =>
                          asPractitionerLineageKey(
                            practitioner.lineageKey ?? practitioner._id,
                          ),
                        ),
                    },
          }
        : undefined;

    await ctx.db.patch("blockedSlots", id, {
      ...updates,
      lastModified: BigInt(Date.now()),
      ...updatedReferences,
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
    await requirePracticeManagerForMutation(
      ctx,
      existingBlockedSlot.practiceId,
    );
    await ctx.db.delete("blockedSlots", args.id);
    return null;
  },
  returns: v.null(),
});

async function deleteAllSimulatedBlockedSlotsForPractice(
  db: MutationCtx["db"],
  practiceId: Id<"practices">,
): Promise<number> {
  const simulatedBlockedSlots = await db
    .query("blockedSlots")
    .withIndex("by_practiceId_isSimulation", (q) =>
      q.eq("practiceId", practiceId).eq("isSimulation", true),
    )
    .collect();

  for (const blockedSlot of simulatedBlockedSlots) {
    await db.delete("blockedSlots", blockedSlot._id);
  }

  return simulatedBlockedSlots.length;
}

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
    await requirePracticeStaffForMutation(ctx, args.practiceId);
    const appointmentsDeleted = await deleteAllSimulatedAppointmentsForPractice(
      ctx.db,
      args.practiceId,
    );
    const blockedSlotsDeleted = await deleteAllSimulatedBlockedSlotsForPractice(
      ctx.db,
      args.practiceId,
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
