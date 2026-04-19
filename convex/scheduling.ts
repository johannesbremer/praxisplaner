import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { IsoDateString } from "../lib/typed-regex";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type {
  LocationId,
  LocationLineageKey,
  PractitionerId,
  PractitionerLineageKey,
} from "./identity";
import type { AppointmentContext } from "./ruleEngine";

import {
  getPractitionerVacationRangesForDate,
  getPractitionerWorkingRangesForDate,
  type MinuteRange,
  minuteRangeContains,
} from "../lib/vacation-utils";
import { internal } from "./_generated/api";
import { internalQuery, query } from "./_generated/server";
import {
  type AppointmentBookingScope,
  getEffectiveAppointmentsForOccupancyView,
  getOccupancyViewForBookingScope,
} from "./appointmentConflicts";
import { asLocationLineageKey, asPractitionerLineageKey } from "./identity";
import { ensurePracticeAccessForQuery } from "./practiceAccess";
import {
  buildPreloadedDayData,
  evaluateLoadedRulesHelper,
  preEvaluateDayInvariantRulesHelper,
} from "./ruleEngine";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import {
  generateCandidateSlotsForDay,
  isSlotStartInFuture,
  SCHEDULING_TIMEZONE,
  slotOverlapsAppointment,
  slotOverlapsBlockedSlot,
} from "./schedulingCore";
import {
  asAvailableSlotsResult,
  asDateRangeInput,
  asIsoDateString,
  asSchedulingResultSlot,
  asSimulatedContextInput,
  asZonedDateTimeString,
  type SimulatedContextInput,
  type ZonedDateTimeString,
} from "./typedDtos";
import { ensureAuthenticatedIdentity } from "./userIdentity";
import {
  availableSlotsResultValidator,
  dateRangeValidator,
  simulatedContextValidator,
} from "./validators";

/**
 * Get the current time as a ZonedDateTime string in the configured timezone.
 */
export interface InternalSchedulingResultSlot extends SchedulingResultSlot {
  locationId: LocationId;
  locationLineageKey: LocationLineageKey;
  practitionerId: PractitionerId;
  practitionerLineageKey: PractitionerLineageKey;
}

export interface SchedulingResultSlot {
  blockedByBlockedSlotId?: Id<"blockedSlots">; // ID of manual blocked slot that caused this
  blockedByRuleId?: Id<"ruleConditions">;
  duration: number; // minutes
  locationId: Id<"locations">;
  practitionerId: Id<"practitioners">;
  practitionerName: string;
  reason?: string; // Natural language explanation for blocked slots
  startTime: ZonedDateTimeString; // ISO string
  status: "AVAILABLE" | "BLOCKED";
}

const schedulingResultSlotValidator = v.object({
  blockedByBlockedSlotId: v.optional(v.id("blockedSlots")),
  blockedByRuleId: v.optional(v.id("ruleConditions")),
  duration: v.number(),
  locationId: v.id("locations"),
  practitionerId: v.id("practitioners"),
  practitionerName: v.string(),
  reason: v.optional(v.string()),
  startTime: v.string(),
  status: v.union(v.literal("AVAILABLE"), v.literal("BLOCKED")),
});

const internalSchedulingResultSlotValidator = v.object({
  blockedByBlockedSlotId: v.optional(v.id("blockedSlots")),
  blockedByRuleId: v.optional(v.id("ruleConditions")),
  duration: v.number(),
  locationId: v.id("locations"),
  locationLineageKey: v.id("locations"),
  practitionerId: v.id("practitioners"),
  practitionerLineageKey: v.id("practitioners"),
  practitionerName: v.string(),
  reason: v.optional(v.string()),
  startTime: v.string(),
  status: v.union(v.literal("AVAILABLE"), v.literal("BLOCKED")),
});

const internalAvailableSlotsResultValidator = v.object({
  log: v.array(v.string()),
  slots: v.array(internalSchedulingResultSlotValidator),
});

function formatDateForIndex(date: Date): IsoDateString {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return asIsoDateString(`${year}-${month}-${day}`);
}

function getCachedVacationRangesForPractitionerLocation(
  cache: Map<string, MinuteRange[]>,
  date: Temporal.PlainDate,
  practitionerId: Id<"practitioners">,
  schedules: Doc<"baseSchedules">[],
  vacations: Doc<"vacations">[],
  locationId?: Id<"locations">,
): MinuteRange[] {
  const key = `${practitionerId}:${locationId ?? "all"}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const ranges = getPractitionerVacationRangesForDate(
    date,
    practitionerId,
    schedules,
    vacations,
    locationId,
  );
  cache.set(key, ranges);
  return ranges;
}

function getNowAsZonedString(): string {
  return Temporal.Now.zonedDateTimeISO(SCHEDULING_TIMEZONE).toString();
}

function toPublicSchedulingResult(args: {
  log: string[];
  slots: InternalSchedulingResultSlot[];
}): { log: string[]; slots: SchedulingResultSlot[] } {
  return {
    log: args.log,
    slots: args.slots.map((slot) => toPublicSchedulingResultSlot(slot)),
  };
}

function toPublicSchedulingResultSlot(
  slot: InternalSchedulingResultSlot,
): SchedulingResultSlot {
  return {
    duration: slot.duration,
    locationId: slot.locationId,
    practitionerId: slot.practitionerId,
    practitionerName: slot.practitionerName,
    startTime: asZonedDateTimeString(slot.startTime),
    status: slot.status,
    ...(slot.blockedByBlockedSlotId && {
      blockedByBlockedSlotId: slot.blockedByBlockedSlotId,
    }),
    ...(slot.blockedByRuleId && {
      blockedByRuleId: slot.blockedByRuleId,
    }),
    ...(slot.reason && { reason: slot.reason }),
  };
}

/**
 * Lightweight query to get available dates within a range.
 * Only checks base schedules without running rule evaluation.
 * Used for calendar display to avoid 32k document read limit.
 */
export const getAvailableDates = query({
  args: {
    dateRange: dateRangeValidator,
    practiceId: v.id("practices"),
    simulatedContext: simulatedContextValidator,
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const dateRange = asDateRangeInput(args.dateRange);
    const simulatedContext = asSimulatedContextInput(args.simulatedContext);
    const availableDates = new Set<string>();
    const practice = await ctx.db.get("practices", args.practiceId);
    const ruleSetId = practice?.currentActiveRuleSetId;

    if (!ruleSetId) {
      return { dates: [] };
    }

    const [practitioners, baseSchedules, vacations] = await Promise.all([
      ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      ctx.db
        .query("baseSchedules")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
      ctx.db
        .query("vacations")
        .withIndex("by_ruleSetId_date", (q) =>
          q
            .eq("ruleSetId", ruleSetId)
            .gte("date", formatDateForIndex(new Date(dateRange.start)))
            .lte("date", formatDateForIndex(new Date(dateRange.end))),
        )
        .collect(),
    ]);

    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);

    for (const practitioner of practitioners) {
      // Check each day in the range
      for (
        let currentDate = new Date(startDate);
        currentDate <= endDate;
        currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000)
      ) {
        const plainDate = Temporal.PlainDate.from({
          day: currentDate.getUTCDate(),
          month: currentDate.getUTCMonth() + 1,
          year: currentDate.getUTCFullYear(),
        });
        const workingRanges = getPractitionerWorkingRangesForDate(
          plainDate,
          practitioner._id,
          baseSchedules,
          simulatedContext.locationId,
        );
        if (workingRanges.length === 0) {
          continue;
        }

        const vacationRanges = getPractitionerVacationRangesForDate(
          plainDate,
          practitioner._id,
          baseSchedules,
          vacations,
          simulatedContext.locationId,
        );

        const hasAvailableMinutes = workingRanges.some(
          (range) =>
            range.startMinutes < range.endMinutes &&
            !vacationRanges.some(
              (vacationRange) =>
                vacationRange.startMinutes <= range.startMinutes &&
                vacationRange.endMinutes >= range.endMinutes,
            ),
        );

        if (hasAvailableMinutes) {
          // Format as YYYY-MM-DD
          const year = currentDate.getUTCFullYear();
          const month = String(currentDate.getUTCMonth() + 1).padStart(2, "0");
          const day = String(currentDate.getUTCDate()).padStart(2, "0");
          availableDates.add(`${year}-${month}-${day}`);
        }
      }
    }

    return {
      dates: [...availableDates].toSorted(),
    };
  },
  returns: v.object({
    dates: v.array(v.string()),
  }),
});

/**
 * Get available slots for a single day - optimized to avoid hitting document read limits.
 * This query should be used for all UIs where slots are displayed.
 *
 * The old getAvailableSlots query was removed because it would hit the 32k document read
 * limit when evaluating rules for large date ranges (e.g., 182 days).
 */
const getSlotsForDayArgs = {
  date: v.string(), // ISO date string for the specific day (e.g., "2025-10-21")
  enforceFutureOnly: v.optional(v.boolean()),
  excludedAppointmentIds: v.optional(v.array(v.id("appointments"))),
  practiceId: v.id("practices"),
  ruleSetId: v.optional(v.id("ruleSets")),
  scope: v.optional(v.union(v.literal("real"), v.literal("simulation"))),
  simulatedContext: simulatedContextValidator,
};

async function getSlotsForDayImpl(
  ctx: QueryCtx,
  args: {
    date: IsoDateString;
    enforceFutureOnly?: boolean;
    excludedAppointmentIds?: Id<"appointments">[];
    practiceId: Id<"practices">;
    ruleSetId?: Id<"ruleSets">;
    scope?: AppointmentBookingScope;
    simulatedContext: SimulatedContextInput;
  },
): Promise<{ log: string[]; slots: InternalSchedulingResultSlot[] }> {
  // Ensure appointmentTypeId is present for rule evaluation
  if (!args.simulatedContext.appointmentTypeId) {
    throw new Error(
      "appointmentTypeId is required in simulatedContext for scheduling queries",
    );
  }

  // Parse the date directly as a Temporal.PlainDate to avoid timezone issues
  const targetPlainDate = Temporal.PlainDate.from(args.date);

  const log: string[] = [`Getting slots for single day: ${args.date}`];
  requireSchedulableAppointmentType(
    await ctx.db.get(
      "appointmentTypes",
      args.simulatedContext.appointmentTypeId,
    ),
    args.simulatedContext.appointmentTypeId,
  );
  const appointmentScope = args.scope ?? "real";
  const excludedAppointmentIds = new Set(args.excludedAppointmentIds);

  // Fetch blocked slots for this practice and date using efficient date range query
  const dayStart = targetPlainDate
    .toZonedDateTime({
      plainTime: Temporal.PlainTime.from("00:00"),
      timeZone: SCHEDULING_TIMEZONE,
    })
    .toString();

  const dayEnd = targetPlainDate
    .add({ days: 1 })
    .toZonedDateTime({
      plainTime: Temporal.PlainTime.from("00:00"),
      timeZone: SCHEDULING_TIMEZONE,
    })
    .toString();

  const allBlockedSlots = await ctx.db
    .query("blockedSlots")
    .withIndex("by_practiceId_start", (q) =>
      q
        .eq("practiceId", args.practiceId)
        .gte("start", dayStart)
        .lt("start", dayEnd),
    )
    .collect();

  const blockedSlotsForDay =
    appointmentScope === "simulation"
      ? combineBlockedSlotsForSimulation(allBlockedSlots)
      : allBlockedSlots.filter(
          (blockedSlot) => blockedSlot.isSimulation !== true,
        );

  log.push(`Found ${blockedSlotsForDay.length} blocked slots for this day`);

  // Determine which rule set to use
  let ruleSetId = args.ruleSetId;
  if (!ruleSetId) {
    const practice = await ctx.db.get("practices", args.practiceId);
    if (practice?.currentActiveRuleSetId) {
      ruleSetId = practice.currentActiveRuleSetId;
    } else {
      log.push("No active rule set found, no rules will be applied");
      ruleSetId = undefined;
    }
  }

  if (!ruleSetId) {
    log.push("No rule set available for candidate slot generation");
    return { log, slots: [] };
  }
  log.push(`Using rule set: ${ruleSetId}`);

  const vacationsForDay = await ctx.db
    .query("vacations")
    .withIndex("by_ruleSetId_date", (q) =>
      q.eq("ruleSetId", ruleSetId).eq("date", targetPlainDate.toString()),
    )
    .collect();
  const practitionerVacationsForDay = vacationsForDay.filter(
    (vacation) => vacation.staffType === "practitioner",
  );
  const vacationRangesByPractitionerLocation = new Map<string, MinuteRange[]>();

  // Fetch relevant practitioners scoped to the active rule set.
  const ruleSetPractitioners = await ctx.db
    .query("practitioners")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .collect();
  const practitioners = ruleSetPractitioners.filter(
    (practitioner) => practitioner.practiceId === args.practiceId,
  );

  log.push(`Found ${practitioners.length} practitioners`);

  // Fetch available locations scoped to the active rule set.
  const [ruleSetLocations, ruleSetBaseSchedules] = await Promise.all([
    ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
    ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect(),
  ]);
  const locations = ruleSetLocations.filter(
    (location) => location.practiceId === args.practiceId,
  );

  log.push(`Found ${locations.length} locations`);

  // Determine default location
  let defaultLocationId: Id<"locations"> | undefined;
  if (args.simulatedContext.locationId) {
    defaultLocationId = args.simulatedContext.locationId;
    log.push(`Using specified location: ${defaultLocationId}`);
  } else if (locations.length > 0) {
    const firstLocation = locations[0];
    if (firstLocation) {
      defaultLocationId = firstLocation._id;
      log.push(`Using default location: ${defaultLocationId}`);
    }
  } else {
    log.push("No locations available - slots will have no location assigned");
  }

  // Generate candidate slots using shared helper
  let candidateSlots = await generateCandidateSlotsForDay(ctx.db, {
    date: targetPlainDate,
    ...(defaultLocationId && { locationId: defaultLocationId }),
    practiceId: args.practiceId,
    ruleSetId,
  });

  if (args.enforceFutureOnly === true) {
    const nowInstant = Temporal.Now.instant();
    const previousCount = candidateSlots.length;
    candidateSlots = candidateSlots.filter((slot) =>
      isSlotStartInFuture(slot.startTime, nowInstant),
    );
    log.push(
      `Filtered past slots: ${previousCount - candidateSlots.length} removed`,
    );
  }

  log.push(`Generated ${candidateSlots.length} candidate slots`);

  for (const slot of candidateSlots) {
    const slotStart = Temporal.ZonedDateTime.from(slot.startTime);
    const slotMinute = slotStart.hour * 60 + slotStart.minute;
    const vacationRanges = getCachedVacationRangesForPractitionerLocation(
      vacationRangesByPractitionerLocation,
      targetPlainDate,
      slot.practitionerId,
      ruleSetBaseSchedules,
      practitionerVacationsForDay,
      slot.locationId,
    );

    if (minuteRangeContains(vacationRanges, slotMinute)) {
      slot.reason = "Urlaub";
      slot.status = "BLOCKED";
    }
  }

  log.push("Marked slots blocked by vacations");

  // Mark manually blocked slots
  for (const slot of candidateSlots) {
    if (slot.status === "BLOCKED") {
      continue;
    }
    // Check if this slot overlaps with any blocked slot
    const blockingSlot = blockedSlotsForDay.find((blockedSlot) =>
      slotOverlapsBlockedSlot(slot, blockedSlot),
    );

    if (blockingSlot) {
      slot.status = "BLOCKED";
      slot.blockedByBlockedSlotId = blockingSlot._id;
    }
  }

  log.push(`Marked slots blocked by manual blocks`);

  // Apply rules
  {
    let totalBlockedCount = 0;

    // At this point we know appointmentTypeId exists due to the guard above
    const appointmentTypeId = args.simulatedContext.appointmentTypeId;

    // PERFORMANCE FIX: Load rules once and evaluate them for all slots
    // instead of loading rules separately for each slot
    const rulesResultRaw = await ctx.runQuery(
      internal.ruleEngine.loadRulesForRuleSet,
      { ruleSetId },
    );

    // Reconstruct the Map ONCE here to avoid repeated serialization
    const conditionsMap = new Map<Id<"ruleConditions">, Doc<"ruleConditions">>(
      Object.entries(
        rulesResultRaw.conditionsMap as Record<string, Doc<"ruleConditions">>,
      ).map(([id, condition]) => [id as Id<"ruleConditions">, condition]),
    );

    const rulesData = {
      conditions: rulesResultRaw.conditions,
      conditionsMap,
      dayInvariantCount: rulesResultRaw.dayInvariantCount,
      rules: rulesResultRaw.rules,
      timeVariantCount: rulesResultRaw.timeVariantCount,
      totalConditions: rulesResultRaw.totalConditions,
    };

    log.push(
      `Loaded ${rulesData.rules.length} rules with ${rulesData.totalConditions} total conditions`,
      `Rule classification: ${rulesData.dayInvariantCount} day-invariant, ${rulesData.timeVariantCount} time-variant`,
    );

    // Build preloaded appointment data ONCE per query execution for all rule evaluations
    // This single query replaces ~26,000 per-slot database reads
    const dayStr = targetPlainDate.toString(); // YYYY-MM-DD format
    const preloadedData = await buildPreloadedDayData(
      ctx.db,
      args.practiceId,
      dayStr,
      ruleSetId,
      practitioners,
    );

    // Build practitioners Map for rule evaluation
    const practitionersMap = new Map(practitioners.map((p) => [p._id, p]));

    log.push(
      `Pre-loaded ${preloadedData.appointments.length} appointments for rule evaluation`,
    );

    const effectiveAppointments = getEffectiveAppointmentsForOccupancyView(
      preloadedData.appointments,
      getOccupancyViewForBookingScope(appointmentScope),
      ruleSetId,
    );

    for (const slot of candidateSlots) {
      if (slot.status === "BLOCKED") {
        continue;
      }

      const overlappingAppointment = effectiveAppointments.find(
        (appointment) =>
          !excludedAppointmentIds.has(appointment._id) &&
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

    log.push("Marked slots blocked by existing appointments");

    // Pre-evaluate day-invariant rules once for the entire day
    // Use the simulatedContext since appointmentTypeId and locationId are fixed for the entire query
    let preEvaluatedDayRules;
    if (rulesData.dayInvariantCount > 0 && candidateSlots.length > 0) {
      const firstSlot = candidateSlots[0];
      if (firstSlot) {
        const dayContext = {
          appointmentTypeId,
          dateTime: firstSlot.startTime, // Any slot time works for day-invariant rules
          ...(args.simulatedContext.patient.dateOfBirth && {
            patientDateOfBirth: args.simulatedContext.patient.dateOfBirth,
          }),
          practiceId: args.practiceId,
          // Note: We use the first slot's practitionerId here, but PRACTITIONER conditions
          // should NOT be in the day-invariant set since practitionerId varies per slot
          practitionerId: firstSlot.practitionerId,
          requestedAt:
            args.simulatedContext.requestedAt ?? getNowAsZonedString(),
          // locationId comes from simulatedContext (fixed for entire query) or slot's default
          ...(args.simulatedContext.locationId && {
            locationId: args.simulatedContext.locationId,
          }),
          ...(!args.simulatedContext.locationId && {
            locationId: firstSlot.locationId,
          }),
        };

        // PERFORMANCE: Call helper directly to avoid serialization overhead
        preEvaluatedDayRules = preEvaluateDayInvariantRulesHelper(
          dayContext,
          rulesData,
          practitionersMap,
        );

        log.push(
          `Pre-evaluated ${preEvaluatedDayRules.evaluatedCount} day-invariant rules: ${preEvaluatedDayRules.blockedByRuleIds.length} blocking`,
        );
      }
    }

    for (const slot of candidateSlots) {
      if (slot.status === "BLOCKED") {
        continue;
      }

      const appointmentContext = {
        appointmentTypeId,
        dateTime: slot.startTime,
        ...(args.simulatedContext.patient.dateOfBirth && {
          patientDateOfBirth: args.simulatedContext.patient.dateOfBirth,
        }),
        locationId: slot.locationId,
        practiceId: args.practiceId,
        practitionerId: slot.practitionerId,
        requestedAt: args.simulatedContext.requestedAt ?? getNowAsZonedString(),
      };

      // PERFORMANCE: Call helper directly to avoid serialization overhead
      // evaluateLoadedRulesHelper is now synchronous with preloaded data
      const ruleCheckResult = evaluateLoadedRulesHelper(
        appointmentContext,
        rulesData,
        preloadedData,
        preEvaluatedDayRules,
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

    log.push(`Rules blocked ${totalBlockedCount} slots`);
  }

  // Return final results
  const finalSlots: InternalSchedulingResultSlot[] = candidateSlots.map(
    (slot) => {
      const slotResult: InternalSchedulingResultSlot = {
        duration: slot.duration,
        locationId: slot.locationId,
        locationLineageKey: slot.locationLineageKey,
        practitionerId: slot.practitionerId,
        practitionerLineageKey: slot.practitionerLineageKey,
        practitionerName: slot.practitionerName ?? "Unknown Practitioner",
        ...(slot.reason && { reason: slot.reason }),
        startTime: asZonedDateTimeString(slot.startTime),
        status: slot.status,
      };

      if (slot.blockedByBlockedSlotId) {
        slotResult.blockedByBlockedSlotId = slot.blockedByBlockedSlotId;
      }

      if (slot.blockedByRuleId) {
        slotResult.blockedByRuleId = slot.blockedByRuleId;
      }

      return slotResult;
    },
  );

  // Generate natural language reasons for blocked slots
  // PERFORMANCE FIX: Collect unique rule IDs and fetch descriptions once per rule
  // instead of once per slot (which was causing ~25k+ document reads)

  // First, collect unique rule IDs from blocked slots
  const uniqueRuleIds = new Set<Id<"ruleConditions">>();
  for (const slot of finalSlots) {
    if (slot.status === "BLOCKED" && slot.blockedByRuleId) {
      uniqueRuleIds.add(slot.blockedByRuleId);
    }
  }

  // Fetch descriptions for unique rules only (once per rule, not per slot)
  const ruleDescriptionCache = new Map<Id<"ruleConditions">, string>();
  for (const ruleId of uniqueRuleIds) {
    try {
      const ruleDescription = await ctx.runQuery(
        internal.ruleEngine.getRuleDescription,
        { ruleId },
      );
      ruleDescriptionCache.set(
        ruleId,
        ruleDescription.treeStructure.trim() ||
          "Dieser Zeitfenster ist durch eine Regel blockiert.",
      );
    } catch (error) {
      ruleDescriptionCache.set(
        ruleId,
        "Dieser Zeitfenster ist durch eine Regel blockiert.",
      );
      log.push(
        `Failed to generate reason for rule ${ruleId}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  log.push(
    `Generated descriptions for ${ruleDescriptionCache.size} unique blocking rules`,
  );

  // Apply reasons to blocked slots using cached descriptions
  for (const slot of finalSlots) {
    if (slot.status === "BLOCKED") {
      if (slot.reason) {
        continue;
      }
      if (slot.blockedByBlockedSlotId) {
        // Handle manual blocked slots
        const blockedSlot = blockedSlotsForDay.find(
          (bs) => bs._id === slot.blockedByBlockedSlotId,
        );
        slot.reason = blockedSlot?.title || "Manuell blockierter Zeitraum";
      } else if (slot.blockedByRuleId) {
        // Use cached description
        slot.reason =
          ruleDescriptionCache.get(slot.blockedByRuleId) ||
          "Dieser Zeitfenster ist durch eine Regel blockiert.";
      } else {
        slot.reason =
          "Dieser Zeitfenster ist bereits durch einen Termin belegt.";
      }
    }
  }

  log.push(
    `Final result: ${finalSlots.filter((s) => s.status === "AVAILABLE").length} available slots, ${finalSlots.filter((s) => s.status === "BLOCKED").length} blocked slots`,
  );

  return { log, slots: finalSlots };
}

function requireSchedulableAppointmentType<T extends { deleted?: boolean }>(
  appointmentType: null | T | undefined,
  appointmentTypeId: Id<"appointmentTypes">,
): T {
  if (!appointmentType) {
    throw new Error(`Appointment type with ID ${appointmentTypeId} not found`);
  }
  if (isRuleSetEntityDeleted(appointmentType)) {
    throw new Error(
      `Appointment type with ID ${appointmentTypeId} was deleted and can no longer be used for new scheduling.`,
    );
  }
  return appointmentType;
}

export const getSlotsForDay = query({
  args: getSlotsForDayArgs,
  handler: async (
    ctx,
    args,
  ): Promise<{ log: string[]; slots: SchedulingResultSlot[] }> => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    return asAvailableSlotsResult(
      toPublicSchedulingResult(
        await getSlotsForDayImpl(ctx, {
          ...args,
          date: asIsoDateString(args.date),
          simulatedContext: asSimulatedContextInput(args.simulatedContext),
        }),
      ),
    );
  },
  returns: availableSlotsResultValidator,
});

export const getNextAvailableSlot = query({
  args: {
    date: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.optional(v.id("ruleSets")),
    scope: v.optional(v.union(v.literal("real"), v.literal("simulation"))),
    simulatedContext: simulatedContextValidator,
  },
  handler: async (ctx, args): Promise<null | SchedulingResultSlot> => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const date = asIsoDateString(args.date);
    const simulatedContext = asSimulatedContextInput(args.simulatedContext);

    const appointmentTypeId = simulatedContext.appointmentTypeId;
    if (!appointmentTypeId) {
      throw new Error(
        "appointmentTypeId is required in simulatedContext for scheduling queries",
      );
    }

    const appointmentType = requireSchedulableAppointmentType(
      await ctx.db.get("appointmentTypes", appointmentTypeId),
      appointmentTypeId,
    );

    const allowedPractitionerIds = new Set(
      appointmentType.allowedPractitionerIds,
    );
    const startDate = Temporal.PlainDate.from(date);
    const maxSearchDays = 90;
    let effectiveRuleSetId = args.ruleSetId;

    if (!effectiveRuleSetId) {
      const practice = await ctx.db.get("practices", args.practiceId);
      effectiveRuleSetId = practice?.currentActiveRuleSetId;
    }

    if (!effectiveRuleSetId) {
      return null;
    }

    const baseSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", effectiveRuleSetId))
      .collect();

    const searchableDayOfWeekSet = new Set(
      baseSchedules
        .filter((schedule) => {
          if (schedule.practiceId !== args.practiceId) {
            return false;
          }

          if (!allowedPractitionerIds.has(schedule.practitionerId)) {
            return false;
          }

          if (
            simulatedContext.locationId &&
            schedule.locationId !== simulatedContext.locationId
          ) {
            return false;
          }

          return true;
        })
        .map((schedule) => schedule.dayOfWeek),
    );

    if (searchableDayOfWeekSet.size === 0) {
      return null;
    }

    for (let offset = 0; offset <= maxSearchDays; offset += 1) {
      const day = startDate.add({ days: offset });
      const legacyDayOfWeek = day.dayOfWeek === 7 ? 0 : day.dayOfWeek;

      if (!searchableDayOfWeekSet.has(legacyDayOfWeek)) {
        continue;
      }

      const dayResult: Awaited<ReturnType<typeof getSlotsForDayImpl>> =
        await ctx.runQuery(internal.scheduling.getSlotsForDayInternal, {
          ...args,
          date: day.toString(),
          enforceFutureOnly: true,
          ruleSetId: effectiveRuleSetId,
          simulatedContext,
        });

      const nextSlot: InternalSchedulingResultSlot | null =
        dayResult.slots
          .filter(
            (slot: InternalSchedulingResultSlot) =>
              slot.status === "AVAILABLE" &&
              allowedPractitionerIds.has(slot.practitionerId),
          )
          .toSorted((left, right) =>
            left.startTime.localeCompare(right.startTime),
          )[0] ?? null;

      if (nextSlot) {
        return asSchedulingResultSlot(toPublicSchedulingResultSlot(nextSlot));
      }
    }

    return null;
  },
  returns: v.union(v.null(), schedulingResultSlotValidator),
});

export const getSlotsForDayInternal = internalQuery({
  args: getSlotsForDayArgs,
  handler: async (
    ctx,
    args,
  ): Promise<{ log: string[]; slots: InternalSchedulingResultSlot[] }> => {
    return await getSlotsForDayImpl(ctx, {
      ...args,
      date: asIsoDateString(args.date),
      simulatedContext: asSimulatedContextInput(args.simulatedContext),
    });
  },
  returns: internalAvailableSlotsResultValidator,
});

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

/**
 * Get blocked slots for a day without requiring appointment type.
 * This is used to show blocks from appointment-type-independent rules (e.g., DATE_RANGE, DAY_OF_WEEK)
 * before the user selects an appointment type, making the UI more responsive.
 */
export const getBlockedSlotsWithoutAppointmentType = query({
  args: {
    date: v.string(), // ISO date string
    locationId: v.optional(v.id("locations")),
    practiceId: v.id("practices"),
    ruleSetId: v.optional(v.id("ruleSets")),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const date = asIsoDateString(args.date);
    const targetPlainDate = Temporal.PlainDate.from(date);

    // Determine which rule set to use
    let ruleSetId = args.ruleSetId;
    if (!ruleSetId) {
      const practice = await ctx.db.get("practices", args.practiceId);
      if (practice?.currentActiveRuleSetId) {
        ruleSetId = practice.currentActiveRuleSetId;
      }
    }

    if (!ruleSetId) {
      // No rules to apply, return empty slots
      return { slots: [] };
    }

    // Generate candidate slots using shared helper
    const candidateSlots = await generateCandidateSlotsForDay(ctx.db, {
      date: targetPlainDate,
      ...(args.locationId && { locationId: args.locationId }),
      practiceId: args.practiceId,
      ruleSetId,
    });

    // NOTE: We intentionally do NOT mark manually blocked slots here.
    // Manual blocks are handled separately by the frontend's manualBlockedSlots useMemo
    // to maintain their draggable/interactive behavior. If we marked them here,
    // they would be rendered as rule-based overlays instead of interactive blocks.

    // Load rules that are appointment-type-independent
    const rulesResultRaw = await ctx.runQuery(
      internal.ruleEngine.loadAppointmentTypeIndependentRules,
      { ruleSetId },
    );

    if (rulesResultRaw.rules.length === 0) {
      // No appointment-type-independent rules, return empty
      return { slots: [] };
    }

    // Reconstruct the Map
    const conditionsMap = new Map<Id<"ruleConditions">, Doc<"ruleConditions">>(
      Object.entries(
        rulesResultRaw.conditionsMap as Record<string, Doc<"ruleConditions">>,
      ).map(([id, condition]) => [id as Id<"ruleConditions">, condition]),
    );

    const rulesData = {
      conditions: rulesResultRaw.conditions,
      conditionsMap,
      rules: rulesResultRaw.rules,
    };

    // Load practitioners for preloaded data
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    // Build preloaded appointment data for rule evaluations
    const dayStr = targetPlainDate.toString();
    const preloadedData = await buildPreloadedDayData(
      ctx.db,
      args.practiceId,
      dayStr,
      ruleSetId,
      practitioners,
    );

    // Evaluate appointment-type-independent rules for each slot
    // We use a dummy appointment type ID since these rules don't depend on it
    const dummyAppointmentTypeId = "" as Id<"appointmentTypes">;

    for (const slot of candidateSlots) {
      if (slot.status === "BLOCKED") {
        continue;
      }

      const appointmentContext: AppointmentContext = {
        appointmentTypeId: dummyAppointmentTypeId,
        dateTime: slot.startTime,
        locationId: slot.locationId,
        practiceId: args.practiceId,
        practitionerId: slot.practitionerId,
        requestedAt: getNowAsZonedString(),
      };

      // evaluateLoadedRulesHelper is now synchronous with preloaded data
      const ruleCheckResult = evaluateLoadedRulesHelper(
        appointmentContext,
        rulesData,
        preloadedData, // No pre-evaluated day rules
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
      }
    }

    // Generate natural language reasons for blocked slots
    // Collect unique rule IDs and fetch descriptions once per rule
    const uniqueRuleIds = new Set<Id<"ruleConditions">>();
    for (const slot of candidateSlots) {
      if (slot.status === "BLOCKED" && slot.blockedByRuleId) {
        uniqueRuleIds.add(slot.blockedByRuleId);
      }
    }

    // Fetch descriptions for unique rules only (once per rule, not per slot)
    const ruleDescriptionCache = new Map<Id<"ruleConditions">, string>();
    for (const ruleId of uniqueRuleIds) {
      try {
        const ruleDescription = await ctx.runQuery(
          internal.ruleEngine.getRuleDescription,
          { ruleId },
        );
        ruleDescriptionCache.set(
          ruleId,
          ruleDescription.treeStructure.trim() ||
            "Dieser Zeitfenster ist durch eine Regel blockiert.",
        );
      } catch {
        ruleDescriptionCache.set(
          ruleId,
          "Dieser Zeitfenster ist durch eine Regel blockiert.",
        );
      }
    }

    // Return only blocked slots
    const blockedSlots = candidateSlots
      .filter((slot) => slot.status === "BLOCKED")
      .map((slot) => {
        const result: {
          blockedByBlockedSlotId?: Id<"blockedSlots">;
          blockedByRuleId?: Id<"ruleConditions">;
          duration: number;
          locationId: Id<"locations">;
          practitionerId: Id<"practitioners">;
          reason?: string;
          startTime: string;
          status: "BLOCKED";
        } = {
          duration: slot.duration,
          locationId: slot.locationId,
          practitionerId: slot.practitionerId,
          startTime: asZonedDateTimeString(slot.startTime),
          status: "BLOCKED" as const,
        };

        if (slot.blockedByBlockedSlotId) {
          result.blockedByBlockedSlotId = slot.blockedByBlockedSlotId;
        }

        if (slot.blockedByRuleId) {
          result.blockedByRuleId = slot.blockedByRuleId;
          // Add the reason from cache
          result.reason =
            ruleDescriptionCache.get(result.blockedByRuleId) ||
            "Dieser Zeitfenster ist durch eine Regel blockiert.";
        }

        return result;
      });

    return { slots: blockedSlots };
  },
  returns: v.object({
    slots: v.array(
      v.object({
        blockedByBlockedSlotId: v.optional(v.id("blockedSlots")),
        blockedByRuleId: v.optional(v.id("ruleConditions")),
        duration: v.number(),
        locationId: v.id("locations"),
        practitionerId: v.id("practitioners"),
        reason: v.optional(v.string()),
        startTime: v.string(),
        status: v.literal("BLOCKED"),
      }),
    ),
  }),
});
