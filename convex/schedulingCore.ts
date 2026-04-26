import { Temporal } from "temporal-polyfill";

import type { InstantString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, QueryCtx } from "./_generated/server";
import type { AppointmentBookingScope } from "./appointmentConflicts";

import {
  getPractitionerVacationRangesForDate,
  type MinuteRange,
  minuteRangeContains,
} from "../lib/vacation-utils";
import { internal } from "./_generated/api";
import {
  getEffectiveAppointmentsForOccupancyView,
  getOccupancyViewForBookingScope,
} from "./appointmentConflicts";
import {
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
  type LocationId,
  type LocationLineageKey,
  type PractitionerId,
  type PractitionerLineageKey,
} from "./identity";
import { requireLineageKey } from "./lineage";
import {
  buildPreloadedDayData,
  evaluateLoadedRulesHelper,
  preEvaluateDayInvariantRulesHelper,
} from "./ruleEngine";
import {
  asZonedDateTimeString,
  type SimulatedContextInput,
  type ZonedDateTimeString,
} from "./typedDtos";

export const SCHEDULING_TIMEZONE = "Europe/Berlin";

export interface CandidateSlot {
  blockedByBlockedSlotId?: Id<"blockedSlots">;
  blockedByRuleId?: Id<"ruleConditions">;
  duration: number;
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey: PractitionerLineageKey;
  reason?: string;
  startTime: string;
  status: "AVAILABLE" | "BLOCKED";
}

const DEFAULT_SLOT_DURATION_MINUTES = 5;

export interface CandidateSlotDisplayReferences {
  locationId: LocationId;
  practitionerId: PractitionerId;
  practitionerName: string;
}

export interface CandidateSlotEvaluationBookingContext {
  appointmentTypeId: Id<"appointmentTypes">;
  excludedAppointmentIds?: Id<"appointments">[];
  requestedAt?: InstantString;
  simulatedContext: SimulatedContextInput;
}

export interface CandidateSlotEvaluationDiagnostics {
  appointmentsPreloaded: number;
  candidateSlotsGenerated: number;
  dayInvariantRulesBlocked: number;
  dayInvariantRulesEvaluated: number;
  locationsFound: number;
  manualBlocksFound: number;
  practitionersFound: number;
  ruleConditionsLoaded: number;
  rulesBlocked: number;
  rulesLoaded: number;
  slotsAvailable: number;
  slotsBlocked: number;
  slotsPastFiltered: number;
}

export interface CandidateSlotEvaluationResult {
  diagnostics: CandidateSlotEvaluationDiagnostics;
  manualBlockedSlots: Doc<"blockedSlots">[];
  slots: EvaluatedCandidateSlot[];
}

export interface EvaluatedCandidateSlot extends CandidateSlot {
  displayReferences: CandidateSlotDisplayReferences;
}

interface CandidateSlotDisplayReferenceMaps {
  locationByLineageKey: Map<LocationLineageKey, LocationId>;
  practitionerByLineageKey: Map<
    PractitionerLineageKey,
    { practitionerId: PractitionerId; practitionerName: string }
  >;
}

export async function evaluateCandidateSlotsForDay(
  ctx: QueryCtx,
  args: {
    bookingContext: CandidateSlotEvaluationBookingContext;
    date: Temporal.PlainDate;
    enforceFutureOnly?: boolean;
    locationId?: Id<"locations">;
    practice: Doc<"practices">;
    ruleSetId: Id<"ruleSets">;
    scope: AppointmentBookingScope;
  },
): Promise<CandidateSlotEvaluationResult> {
  const diagnostics: CandidateSlotEvaluationDiagnostics = {
    appointmentsPreloaded: 0,
    candidateSlotsGenerated: 0,
    dayInvariantRulesBlocked: 0,
    dayInvariantRulesEvaluated: 0,
    locationsFound: 0,
    manualBlocksFound: 0,
    practitionersFound: 0,
    ruleConditionsLoaded: 0,
    rulesBlocked: 0,
    rulesLoaded: 0,
    slotsAvailable: 0,
    slotsBlocked: 0,
    slotsPastFiltered: 0,
  };

  const [manualBlockedSlots, ruleSetLocations, ruleSetPractitioners] =
    await Promise.all([
      loadManualBlockedSlotsForDay(ctx.db, {
        date: args.date,
        practiceId: args.practice._id,
        scope: args.scope,
      }),
      ctx.db
        .query("locations")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
        .collect(),
      ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
        .collect(),
    ]);

  const locations = ruleSetLocations.filter(
    (location) => location.practiceId === args.practice._id,
  );
  const practitioners = ruleSetPractitioners.filter(
    (practitioner) => practitioner.practiceId === args.practice._id,
  );
  diagnostics.locationsFound = locations.length;
  diagnostics.manualBlocksFound = manualBlockedSlots.length;
  diagnostics.practitionersFound = practitioners.length;

  const displayReferenceMaps = buildCandidateSlotDisplayReferences({
    locations,
    practiceId: args.practice._id,
    practitioners,
  });

  let candidateSlots = await generateCandidateSlotsForDay(ctx.db, {
    date: args.date,
    ...(args.locationId && { locationId: args.locationId }),
    practiceId: args.practice._id,
    ruleSetId: args.ruleSetId,
  });
  diagnostics.candidateSlotsGenerated = candidateSlots.length;

  if (args.enforceFutureOnly === true) {
    const previousCount = candidateSlots.length;
    const nowInstant = Temporal.Now.instant();
    candidateSlots = candidateSlots.filter((slot) =>
      isSlotStartInFuture(slot.startTime, nowInstant),
    );
    diagnostics.slotsPastFiltered = previousCount - candidateSlots.length;
  }

  await markSlotsBlockedByAbsence(ctx.db, {
    date: args.date,
    practiceId: args.practice._id,
    ruleSetId: args.ruleSetId,
    slots: candidateSlots,
  });
  markSlotsBlockedByManualBlocks(candidateSlots, manualBlockedSlots);

  const rulesResultRaw = await ctx.runQuery(
    internal.ruleEngine.loadRulesForRuleSet,
    { ruleSetId: args.ruleSetId },
  );
  const conditionsMap = new Map<Id<"ruleConditions">, Doc<"ruleConditions">>(
    rulesResultRaw.conditions.map((condition) => [condition._id, condition]),
  );
  const rulesData = {
    conditions: rulesResultRaw.conditions,
    conditionsMap,
    dayInvariantCount: rulesResultRaw.dayInvariantCount,
    rules: rulesResultRaw.rules,
    timeVariantCount: rulesResultRaw.timeVariantCount,
    totalConditions: rulesResultRaw.totalConditions,
  };
  diagnostics.ruleConditionsLoaded = rulesData.totalConditions;
  diagnostics.rulesLoaded = rulesData.rules.length;

  const preloadedData = await buildPreloadedDayData(
    ctx.db,
    args.practice._id,
    args.date.toString(),
    args.ruleSetId,
    practitioners,
  );
  diagnostics.appointmentsPreloaded = preloadedData.appointments.length;

  const excludedAppointmentIds = new Set(
    args.bookingContext.excludedAppointmentIds,
  );
  const effectiveAppointments = getEffectiveAppointmentsForOccupancyView(
    preloadedData.appointments,
    getOccupancyViewForBookingScope(args.scope),
    args.ruleSetId,
  );
  markSlotsBlockedByAppointments(candidateSlots, {
    appointments: effectiveAppointments,
    excludedAppointmentIds,
  });

  const displayReferencesBySlotKey = buildDisplayReferencesBySlotKey(
    candidateSlots,
    displayReferenceMaps,
  );

  const preEvaluatedDayRules =
    rulesData.dayInvariantCount > 0 && candidateSlots.length > 0
      ? preEvaluateCandidateDayRules({
          bookingContext: args.bookingContext,
          displayReferencesBySlotKey,
          practiceId: args.practice._id,
          preloadedData,
          rulesData,
          slots: candidateSlots,
        })
      : undefined;

  if (preEvaluatedDayRules) {
    diagnostics.dayInvariantRulesBlocked =
      preEvaluatedDayRules.blockedByRuleIds.length;
    diagnostics.dayInvariantRulesEvaluated =
      preEvaluatedDayRules.evaluatedCount;
  }

  diagnostics.rulesBlocked = markSlotsBlockedByRules(candidateSlots, {
    bookingContext: args.bookingContext,
    displayReferencesBySlotKey,
    practiceId: args.practice._id,
    preEvaluatedDayRules,
    preloadedData,
    rulesData,
  });

  diagnostics.slotsAvailable = candidateSlots.filter(
    (slot) => slot.status === "AVAILABLE",
  ).length;
  diagnostics.slotsBlocked = candidateSlots.length - diagnostics.slotsAvailable;
  const evaluatedSlots = candidateSlots.map(
    (slot): EvaluatedCandidateSlot => ({
      ...slot,
      displayReferences: getRequiredDisplayReferences(
        displayReferencesBySlotKey,
        slot,
      ),
    }),
  );

  return {
    diagnostics,
    manualBlockedSlots,
    slots: evaluatedSlots,
  };
}

export async function generateCandidateSlotsForDay(
  db: DatabaseReader,
  args: {
    date: Temporal.PlainDate;
    locationId?: Id<"locations">;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
): Promise<CandidateSlot[]> {
  const { date: targetPlainDate, locationId, practiceId, ruleSetId } = args;

  const [locations, practitioners, schedules] = await Promise.all([
    db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
    db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
    db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
  ]);

  const practitionersForPractice = practitioners.filter(
    (practitioner) => practitioner.practiceId === practiceId,
  );
  const practitionerLineageKeys = new Set(
    practitionersForPractice.map((practitioner) =>
      asPractitionerLineageKey(
        requireLineageKey({
          entityId: practitioner._id,
          entityType: "practitioner",
          lineageKey: practitioner.lineageKey,
          ruleSetId: practitioner.ruleSetId,
        }),
      ),
    ),
  );
  const locationIdByLineageKey = new Map(
    locations
      .filter((location) => location.practiceId === practiceId)
      .map((location) => [
        asLocationLineageKey(
          requireLineageKey({
            entityId: location._id,
            entityType: "location",
            lineageKey: location.lineageKey,
            ruleSetId: location.ruleSetId,
          }),
        ),
        asLocationId(location._id),
      ]),
  );

  const dayOfWeek =
    targetPlainDate.dayOfWeek === 7 ? 0 : targetPlainDate.dayOfWeek;

  const filteredSchedules = schedules.filter((schedule) => {
    if (schedule.practiceId !== practiceId) {
      return false;
    }

    if (schedule.dayOfWeek !== dayOfWeek) {
      return false;
    }

    if (
      locationId &&
      locationIdByLineageKey.get(
        asLocationLineageKey(schedule.locationLineageKey),
      ) !== asLocationId(locationId)
    ) {
      return false;
    }

    return true;
  });

  const candidateSlots: CandidateSlot[] = [];

  for (const schedule of filteredSchedules) {
    const scheduleStartTime = Temporal.PlainTime.from(
      `${schedule.startTime}:00`,
    );
    const scheduleEndTime = Temporal.PlainTime.from(`${schedule.endTime}:00`);

    const scheduleStart = targetPlainDate
      .toZonedDateTime({
        plainTime: scheduleStartTime,
        timeZone: SCHEDULING_TIMEZONE,
      })
      .toInstant();

    const scheduleEnd = targetPlainDate
      .toZonedDateTime({
        plainTime: scheduleEndTime,
        timeZone: SCHEDULING_TIMEZONE,
      })
      .toInstant();

    let currentInstant = scheduleStart;
    while (Temporal.Instant.compare(currentInstant, scheduleEnd) < 0) {
      const slotZoned = currentInstant.toZonedDateTimeISO(SCHEDULING_TIMEZONE);
      const timeString = `${slotZoned.hour.toString().padStart(2, "0")}:${slotZoned.minute.toString().padStart(2, "0")}`;

      const isBreakTime =
        schedule.breakTimes?.some(
          (breakTime) =>
            timeString >= breakTime.start && timeString < breakTime.end,
        ) ?? false;

      if (!isBreakTime) {
        const locationLineageKey = asLocationLineageKey(
          schedule.locationLineageKey,
        );
        const practitionerLineageKey = asPractitionerLineageKey(
          schedule.practitionerLineageKey,
        );
        if (!locationIdByLineageKey.has(locationLineageKey)) {
          throw new Error(
            `[INVARIANT:SCHEDULE_LOCATION_NOT_RESOLVED] Arbeitszeit ${schedule._id} referenziert Standort-Lineage ${locationLineageKey}, die in Regelset ${ruleSetId} nicht aufgelöst werden konnte.`,
          );
        }
        if (!practitionerLineageKeys.has(practitionerLineageKey)) {
          throw new Error(
            `[INVARIANT:SCHEDULE_PRACTITIONER_NOT_RESOLVED] Arbeitszeit ${schedule._id} referenziert Behandler-Lineage ${practitionerLineageKey}, die in Regelset ${ruleSetId} nicht aufgelöst werden konnte.`,
          );
        }
        candidateSlots.push({
          duration: DEFAULT_SLOT_DURATION_MINUTES,
          locationLineageKey,
          practitionerLineageKey,
          startTime: slotZoned.toString(),
          status: "AVAILABLE",
        });
      }

      currentInstant = currentInstant.add({
        minutes: DEFAULT_SLOT_DURATION_MINUTES,
      });
    }
  }

  return candidateSlots;
}

export function isSlotStartInFuture(
  startTime: string,
  nowInstant: Temporal.Instant,
): boolean {
  try {
    const slotInstant = Temporal.ZonedDateTime.from(startTime).toInstant();
    return Temporal.Instant.compare(slotInstant, nowInstant) > 0;
  } catch {
    return false;
  }
}

export function slotOverlapsAppointment(
  slot: Pick<
    CandidateSlot,
    "duration" | "locationLineageKey" | "practitionerLineageKey" | "startTime"
  >,
  appointment: Pick<
    Doc<"appointments">,
    "end" | "locationLineageKey" | "practitionerLineageKey" | "start"
  > & {
    locationLineageKey: LocationLineageKey;
    practitionerLineageKey?: PractitionerLineageKey;
  },
): boolean {
  if (slot.locationLineageKey !== appointment.locationLineageKey) {
    return false;
  }

  if (slot.practitionerLineageKey !== appointment.practitionerLineageKey) {
    return false;
  }

  const slotZoned = Temporal.ZonedDateTime.from(slot.startTime);
  const slotEndZoned = slotZoned.add({
    minutes: slot.duration,
  });
  const appointmentStart = Temporal.ZonedDateTime.from(
    appointment.start,
  ).toInstant();
  const appointmentEnd = Temporal.ZonedDateTime.from(
    appointment.end,
  ).toInstant();

  return (
    Temporal.Instant.compare(slotZoned.toInstant(), appointmentEnd) < 0 &&
    Temporal.Instant.compare(slotEndZoned.toInstant(), appointmentStart) > 0
  );
}

export function slotOverlapsBlockedSlot(
  slot: Pick<
    CandidateSlot,
    "duration" | "practitionerLineageKey" | "startTime"
  >,
  blockedSlot: Doc<"blockedSlots">,
): boolean {
  const slotZoned = Temporal.ZonedDateTime.from(slot.startTime);
  const slotEndZoned = slotZoned.add({
    minutes: slot.duration,
  });
  const blockedStart = Temporal.ZonedDateTime.from(
    blockedSlot.start,
  ).toInstant();
  const blockedEnd = Temporal.ZonedDateTime.from(blockedSlot.end).toInstant();

  if (
    blockedSlot.practitionerLineageKey &&
    blockedSlot.practitionerLineageKey !== slot.practitionerLineageKey
  ) {
    return false;
  }

  const slotInstant = slotZoned.toInstant();
  const slotEndInstant = slotEndZoned.toInstant();
  return (
    Temporal.Instant.compare(slotInstant, blockedEnd) < 0 &&
    Temporal.Instant.compare(slotEndInstant, blockedStart) > 0
  );
}

function buildCandidateSlotDisplayReferences(args: {
  locations: Doc<"locations">[];
  practiceId: Id<"practices">;
  practitioners: Doc<"practitioners">[];
}): CandidateSlotDisplayReferenceMaps {
  const locationByLineageKey = new Map<LocationLineageKey, LocationId>();
  for (const location of args.locations) {
    if (location.practiceId !== args.practiceId) {
      continue;
    }
    locationByLineageKey.set(
      asLocationLineageKey(
        requireLineageKey({
          entityId: location._id,
          entityType: "location",
          lineageKey: location.lineageKey,
          ruleSetId: location.ruleSetId,
        }),
      ),
      asLocationId(location._id),
    );
  }

  const practitionerByLineageKey = new Map<
    PractitionerLineageKey,
    { practitionerId: PractitionerId; practitionerName: string }
  >();
  for (const practitioner of args.practitioners) {
    if (practitioner.practiceId !== args.practiceId) {
      continue;
    }
    practitionerByLineageKey.set(
      asPractitionerLineageKey(
        requireLineageKey({
          entityId: practitioner._id,
          entityType: "practitioner",
          lineageKey: practitioner.lineageKey,
          ruleSetId: practitioner.ruleSetId,
        }),
      ),
      {
        practitionerId: asPractitionerId(practitioner._id),
        practitionerName: practitioner.name,
      },
    );
  }

  return { locationByLineageKey, practitionerByLineageKey };
}

function buildDisplayReferencesBySlotKey(
  slots: CandidateSlot[],
  maps: CandidateSlotDisplayReferenceMaps,
): Map<string, CandidateSlotDisplayReferences> {
  const referencesBySlotKey = new Map<string, CandidateSlotDisplayReferences>();
  for (const slot of slots) {
    referencesBySlotKey.set(
      getCandidateSlotKey(slot),
      resolveCandidateSlotDisplayReferences(maps, slot),
    );
  }
  return referencesBySlotKey;
}

function combineBlockedSlotsForSimulation(
  blockedSlots: Doc<"blockedSlots">[],
): Doc<"blockedSlots">[] {
  const simulationSlots = blockedSlots.filter(
    (slot) => slot.isSimulation === true,
  );
  const replacedIds = new Set(
    simulationSlots.map((slot) => slot.replacesBlockedSlotId).filter(Boolean),
  );

  const realSlots = blockedSlots.filter(
    (slot) => slot.isSimulation !== true && !replacedIds.has(slot._id),
  );

  return [...realSlots, ...simulationSlots].toSorted((a, b) =>
    a.start.localeCompare(b.start),
  );
}

function getCachedVacationRangesForPractitionerLocation(
  cache: Map<string, MinuteRange[]>,
  date: Temporal.PlainDate,
  practitionerLineageKey: PractitionerLineageKey,
  schedules: Doc<"baseSchedules">[],
  vacations: Doc<"vacations">[],
  locationLineageKey?: LocationLineageKey,
): MinuteRange[] {
  const key = `${practitionerLineageKey}:${locationLineageKey ?? "all"}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const ranges = getPractitionerVacationRangesForDate(
    date,
    practitionerLineageKey,
    schedules,
    vacations,
    locationLineageKey,
  );
  cache.set(key, ranges);
  return ranges;
}

function getCandidateSlotKey(
  slot: Pick<
    CandidateSlot,
    "locationLineageKey" | "practitionerLineageKey" | "startTime"
  >,
): string {
  return `${slot.startTime}:${slot.locationLineageKey}:${slot.practitionerLineageKey}`;
}

function getRequestedAtForRuleEvaluation(
  requestedAt?: InstantString,
): ZonedDateTimeString {
  if (requestedAt === undefined) {
    return asZonedDateTimeString(
      Temporal.Now.zonedDateTimeISO(SCHEDULING_TIMEZONE).toString(),
    );
  }

  return asZonedDateTimeString(
    Temporal.Instant.from(requestedAt)
      .toZonedDateTimeISO(SCHEDULING_TIMEZONE)
      .toString(),
  );
}

function getRequiredDisplayReferences(
  displayReferencesBySlotKey: Map<string, CandidateSlotDisplayReferences>,
  slot: CandidateSlot,
): CandidateSlotDisplayReferences {
  const displayReferences = displayReferencesBySlotKey.get(
    getCandidateSlotKey(slot),
  );
  if (!displayReferences) {
    throw new Error(
      `[INVARIANT:SLOT_DISPLAY_REFERENCES_NOT_RESOLVED] Slot ${slot.startTime} konnte nicht auf konkrete Anzeige-Referenzen aufgelöst werden.`,
    );
  }
  return displayReferences;
}

async function loadManualBlockedSlotsForDay(
  db: DatabaseReader,
  args: {
    date: Temporal.PlainDate;
    practiceId: Id<"practices">;
    scope: AppointmentBookingScope;
  },
): Promise<Doc<"blockedSlots">[]> {
  const dayStart = args.date
    .toZonedDateTime({
      plainTime: Temporal.PlainTime.from("00:00"),
      timeZone: SCHEDULING_TIMEZONE,
    })
    .toString();

  const dayEnd = args.date
    .add({ days: 1 })
    .toZonedDateTime({
      plainTime: Temporal.PlainTime.from("00:00"),
      timeZone: SCHEDULING_TIMEZONE,
    })
    .toString();

  const blockedSlots = await db
    .query("blockedSlots")
    .withIndex("by_practiceId_start", (q) =>
      q
        .eq("practiceId", args.practiceId)
        .gte("start", dayStart)
        .lt("start", dayEnd),
    )
    .collect();

  return args.scope === "simulation"
    ? combineBlockedSlotsForSimulation(blockedSlots)
    : blockedSlots.filter((blockedSlot) => blockedSlot.isSimulation !== true);
}

async function markSlotsBlockedByAbsence(
  db: DatabaseReader,
  args: {
    date: Temporal.PlainDate;
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
    slots: CandidateSlot[];
  },
): Promise<void> {
  const [vacationsForDay, ruleSetBaseSchedules] = await Promise.all([
    db
      .query("vacations")
      .withIndex("by_ruleSetId_date", (q) =>
        q.eq("ruleSetId", args.ruleSetId).eq("date", args.date.toString()),
      )
      .collect(),
    db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect(),
  ]);
  const practitionerVacationsForDay = vacationsForDay.filter(
    (vacation) =>
      vacation.practiceId === args.practiceId &&
      vacation.staffType === "practitioner",
  );
  const vacationRangesByPractitionerLocation = new Map<string, MinuteRange[]>();

  for (const slot of args.slots) {
    const slotStart = Temporal.ZonedDateTime.from(slot.startTime);
    const slotMinute = slotStart.hour * 60 + slotStart.minute;
    const vacationRanges = getCachedVacationRangesForPractitionerLocation(
      vacationRangesByPractitionerLocation,
      args.date,
      slot.practitionerLineageKey,
      ruleSetBaseSchedules,
      practitionerVacationsForDay,
      slot.locationLineageKey,
    );

    if (minuteRangeContains(vacationRanges, slotMinute)) {
      slot.reason = "Urlaub";
      slot.status = "BLOCKED";
    }
  }
}

function markSlotsBlockedByAppointments(
  slots: CandidateSlot[],
  args: {
    appointments: Doc<"appointments">[];
    excludedAppointmentIds: ReadonlySet<Id<"appointments">>;
  },
): void {
  for (const slot of slots) {
    if (slot.status === "BLOCKED") {
      continue;
    }

    const overlappingAppointment = args.appointments.find(
      (appointment) =>
        !args.excludedAppointmentIds.has(appointment._id) &&
        slotOverlapsAppointment(slot, {
          end: appointment.end,
          locationLineageKey: asLocationLineageKey(
            appointment.locationLineageKey,
          ),
          ...(appointment.practitionerLineageKey
            ? {
                practitionerLineageKey: asPractitionerLineageKey(
                  appointment.practitionerLineageKey,
                ),
              }
            : {}),
          start: appointment.start,
        }),
    );

    if (overlappingAppointment) {
      slot.status = "BLOCKED";
    }
  }
}

function markSlotsBlockedByManualBlocks(
  slots: CandidateSlot[],
  blockedSlots: Doc<"blockedSlots">[],
): void {
  for (const slot of slots) {
    if (slot.status === "BLOCKED") {
      continue;
    }

    const blockingSlot = blockedSlots.find((blockedSlot) =>
      slotOverlapsBlockedSlot(slot, blockedSlot),
    );

    if (blockingSlot) {
      slot.status = "BLOCKED";
      slot.blockedByBlockedSlotId = blockingSlot._id;
    }
  }
}

function markSlotsBlockedByRules(
  slots: CandidateSlot[],
  args: {
    bookingContext: CandidateSlotEvaluationBookingContext;
    displayReferencesBySlotKey: Map<string, CandidateSlotDisplayReferences>;
    practiceId: Id<"practices">;
    preEvaluatedDayRules:
      | ReturnType<typeof preEvaluateDayInvariantRulesHelper>
      | undefined;
    preloadedData: Awaited<ReturnType<typeof buildPreloadedDayData>>;
    rulesData: Parameters<typeof evaluateLoadedRulesHelper>[1];
  },
): number {
  let totalBlockedCount = 0;

  for (const slot of slots) {
    if (slot.status === "BLOCKED") {
      continue;
    }

    const displayReferences = getRequiredDisplayReferences(
      args.displayReferencesBySlotKey,
      slot,
    );
    const appointmentContext = {
      appointmentTypeId: args.bookingContext.appointmentTypeId,
      dateTime: asZonedDateTimeString(slot.startTime),
      ...(args.bookingContext.simulatedContext.patient.dateOfBirth && {
        patientDateOfBirth:
          args.bookingContext.simulatedContext.patient.dateOfBirth,
      }),
      locationId: displayReferences.locationId,
      practiceId: args.practiceId,
      practitionerId: displayReferences.practitionerId,
      requestedAt: getRequestedAtForRuleEvaluation(
        args.bookingContext.requestedAt,
      ),
    };

    const ruleCheckResult = evaluateLoadedRulesHelper(
      appointmentContext,
      args.rulesData,
      args.preloadedData,
      args.preEvaluatedDayRules,
    );

    if (
      ruleCheckResult.isBlocked &&
      ruleCheckResult.blockedByRuleIds.length > 0
    ) {
      slot.status = "BLOCKED";
      const firstBlockingRuleId = ruleCheckResult.blockedByRuleIds[0];
      if (firstBlockingRuleId) {
        slot.blockedByRuleId = firstBlockingRuleId;
      }
      totalBlockedCount++;
    }
  }

  return totalBlockedCount;
}

function preEvaluateCandidateDayRules(args: {
  bookingContext: CandidateSlotEvaluationBookingContext;
  displayReferencesBySlotKey: Map<string, CandidateSlotDisplayReferences>;
  practiceId: Id<"practices">;
  preloadedData: Awaited<ReturnType<typeof buildPreloadedDayData>>;
  rulesData: Parameters<typeof preEvaluateDayInvariantRulesHelper>[1];
  slots: CandidateSlot[];
}): ReturnType<typeof preEvaluateDayInvariantRulesHelper> | undefined {
  const firstSlot = args.slots[0];
  if (!firstSlot) {
    return undefined;
  }

  const firstSlotDisplayReferences = getRequiredDisplayReferences(
    args.displayReferencesBySlotKey,
    firstSlot,
  );
  const dayContext = {
    appointmentTypeId: args.bookingContext.appointmentTypeId,
    dateTime: asZonedDateTimeString(firstSlot.startTime),
    ...(args.bookingContext.simulatedContext.patient.dateOfBirth && {
      patientDateOfBirth:
        args.bookingContext.simulatedContext.patient.dateOfBirth,
    }),
    locationId: firstSlotDisplayReferences.locationId,
    practiceId: args.practiceId,
    practitionerId: firstSlotDisplayReferences.practitionerId,
    requestedAt: getRequestedAtForRuleEvaluation(
      args.bookingContext.requestedAt,
    ),
  };

  return preEvaluateDayInvariantRulesHelper(
    dayContext,
    args.rulesData,
    args.preloadedData,
  );
}

function resolveCandidateSlotDisplayReferences(
  maps: CandidateSlotDisplayReferenceMaps,
  slot: Pick<CandidateSlot, "locationLineageKey" | "practitionerLineageKey">,
): CandidateSlotDisplayReferences {
  const locationId = maps.locationByLineageKey.get(slot.locationLineageKey);
  if (!locationId) {
    throw new Error(
      `[INVARIANT:SLOT_LOCATION_NOT_RESOLVED] Slot referenziert Standort-Lineage ${slot.locationLineageKey}, die im aktuellen Regelset nicht aufgelöst werden konnte.`,
    );
  }

  const practitioner = maps.practitionerByLineageKey.get(
    slot.practitionerLineageKey,
  );
  if (!practitioner) {
    throw new Error(
      `[INVARIANT:SLOT_PRACTITIONER_NOT_RESOLVED] Slot referenziert Behandler-Lineage ${slot.practitionerLineageKey}, die im aktuellen Regelset nicht aufgelöst werden konnte.`,
    );
  }

  return {
    locationId,
    practitionerId: practitioner.practitionerId,
    practitionerName: practitioner.practitionerName,
  };
}
