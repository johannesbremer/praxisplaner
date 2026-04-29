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
} from "../lib/vacation-utils";
import { internal } from "./_generated/api";
import { internalQuery, query } from "./_generated/server";
import { getActiveRuleSetId, requireActiveRuleSetId } from "./activeRuleSets";
import { type AppointmentBookingScope } from "./appointmentConflicts";
import {
  resolveAppointmentTypeIdForRuleSetByLineage,
  resolveLocationIdForRuleSetByLineage,
} from "./appointmentReferences";
import {
  asAppointmentTypeLineageKey,
  asLocationId,
  asLocationLineageKey,
  asPractitionerId,
  asPractitionerLineageKey,
} from "./identity";
import { requireLineageKey } from "./lineage";
import { ensurePracticeAccessForQuery } from "./practiceAccess";
import { buildPreloadedDayData, evaluateLoadedRulesHelper } from "./ruleEngine";
import { isRuleSetEntityDeleted } from "./ruleSetEntityDeletion";
import {
  type CandidateSlot,
  evaluateCandidateSlotsForDay,
  generateCandidateSlotsForDay,
  SCHEDULING_TIMEZONE,
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
export interface InternalSchedulingResultSlot extends Pick<
  CandidateSlot,
  | "blockedByBlockedSlotId"
  | "blockedByRuleId"
  | "duration"
  | "locationLineageKey"
  | "practitionerLineageKey"
  | "reason"
  | "startTime"
  | "status"
> {
  practitionerName: string;
}

export interface SchedulingResultSlot {
  blockedByBlockedSlotId?: Id<"blockedSlots">; // ID of manual blocked slot that caused this
  blockedByRuleId?: Id<"ruleConditions">;
  duration: number; // minutes
  locationLineageKey: LocationLineageKey;
  practitionerLineageKey: PractitionerLineageKey;
  practitionerName: string;
  reason?: string; // Natural language explanation for blocked slots
  startTime: ZonedDateTimeString; // ISO string
  status: "AVAILABLE" | "BLOCKED";
}

const schedulingResultSlotValidator = v.object({
  blockedByBlockedSlotId: v.optional(v.id("blockedSlots")),
  blockedByRuleId: v.optional(v.id("ruleConditions")),
  duration: v.number(),
  locationLineageKey: v.id("locations"),
  practitionerLineageKey: v.id("practitioners"),
  practitionerName: v.string(),
  reason: v.optional(v.string()),
  startTime: v.string(),
  status: v.union(v.literal("AVAILABLE"), v.literal("BLOCKED")),
});

const internalSchedulingResultSlotValidator = v.object({
  blockedByBlockedSlotId: v.optional(v.id("blockedSlots")),
  blockedByRuleId: v.optional(v.id("ruleConditions")),
  duration: v.number(),
  locationLineageKey: v.id("locations"),
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

function buildSchedulingDisplayReferences(args: {
  locations: Doc<"locations">[];
  practiceId: Id<"practices">;
  practitioners: Doc<"practitioners">[];
}) {
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

function formatDateForIndex(date: Date): IsoDateString {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return asIsoDateString(`${year}-${month}-${day}`);
}

function getNowAsZonedString(): ZonedDateTimeString {
  return asZonedDateTimeString(
    Temporal.Now.zonedDateTimeISO(SCHEDULING_TIMEZONE).toString(),
  );
}

async function loadSchedulingDisplayReferenceMaps(
  db: QueryCtx["db"],
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
) {
  const [locations, practitioners] = await Promise.all([
    db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect(),
    db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect(),
  ]);

  return buildSchedulingDisplayReferences({
    locations: locations.filter(
      (location) => location.practiceId === args.practiceId,
    ),
    practiceId: args.practiceId,
    practitioners: practitioners.filter(
      (practitioner) => practitioner.practiceId === args.practiceId,
    ),
  });
}

function resolveSchedulingDisplayReferences(
  maps: ReturnType<typeof buildSchedulingDisplayReferences>,
  slot: Pick<CandidateSlot, "locationLineageKey" | "practitionerLineageKey">,
): {
  locationId: LocationId;
  practitionerId: PractitionerId;
  practitionerName: string;
} {
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
async function resolveSchedulingRuleSetId(
  db: QueryCtx["db"],
  args: {
    practiceId: Id<"practices">;
    preferredRuleSetId?: Id<"ruleSets">;
  },
): Promise<Id<"ruleSets"> | null> {
  if (args.preferredRuleSetId) {
    return args.preferredRuleSetId;
  }

  return await getActiveRuleSetId(db, args.practiceId);
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
    locationLineageKey: slot.locationLineageKey,
    practitionerLineageKey: slot.practitionerLineageKey,
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
    const ruleSetId = await requireActiveRuleSetId(ctx.db, args.practiceId);

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
    const selectedLocationLineageKey =
      simulatedContext.locationLineageKey === undefined
        ? undefined
        : asLocationLineageKey(simulatedContext.locationLineageKey);

    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);

    for (const practitioner of practitioners) {
      if (practitioner.practiceId !== args.practiceId) {
        continue;
      }

      const practitionerLineageKey = asPractitionerLineageKey(
        requireLineageKey({
          entityId: practitioner._id,
          entityType: "practitioner",
          lineageKey: practitioner.lineageKey,
          ruleSetId: practitioner.ruleSetId,
        }),
      );

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
          practitionerLineageKey,
          baseSchedules,
          selectedLocationLineageKey,
        );
        if (workingRanges.length === 0) {
          continue;
        }

        const vacationRanges = getPractitionerVacationRangesForDate(
          plainDate,
          practitionerLineageKey,
          baseSchedules,
          vacations,
          selectedLocationLineageKey,
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
  if (!args.simulatedContext.appointmentTypeLineageKey) {
    throw new Error(
      "appointmentTypeLineageKey is required in simulatedContext for scheduling queries",
    );
  }

  // Parse the date directly as a Temporal.PlainDate to avoid timezone issues
  const targetPlainDate = Temporal.PlainDate.from(args.date);

  const log: string[] = [`Getting slots for single day: ${args.date}`];
  const appointmentScope = args.scope ?? "real";

  // Determine which rule set to use
  let ruleSetId = args.ruleSetId;
  ruleSetId ||= await requireActiveRuleSetId(ctx.db, args.practiceId);

  log.push(`Using rule set: ${ruleSetId}`);
  const practice = await ctx.db.get("practices", args.practiceId);
  if (!practice) {
    throw new Error(`Practice with ID ${args.practiceId} not found`);
  }

  const selectedAppointmentTypeId =
    await resolveAppointmentTypeIdForRuleSetByLineage(ctx.db, {
      lineageKey: asAppointmentTypeLineageKey(
        args.simulatedContext.appointmentTypeLineageKey,
      ),
      ruleSetId,
    });
  requireSchedulableAppointmentType(
    await ctx.db.get("appointmentTypes", selectedAppointmentTypeId),
    selectedAppointmentTypeId,
  );

  const ruleSetLocations = await ctx.db
    .query("locations")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .collect();
  const locations = ruleSetLocations.filter(
    (location) => location.practiceId === args.practiceId,
  );

  // Determine default location
  let defaultLocationId: Id<"locations"> | undefined;
  if (args.simulatedContext.locationLineageKey) {
    defaultLocationId = await resolveLocationIdForRuleSetByLineage(ctx.db, {
      lineageKey: asLocationLineageKey(
        args.simulatedContext.locationLineageKey,
      ),
      ruleSetId,
    });
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

  const evaluation = await evaluateCandidateSlotsForDay(ctx, {
    bookingContext: {
      appointmentTypeId: selectedAppointmentTypeId,
      ...(args.excludedAppointmentIds && {
        excludedAppointmentIds: args.excludedAppointmentIds,
      }),
      ...(args.simulatedContext.requestedAt && {
        requestedAt: args.simulatedContext.requestedAt,
      }),
      simulatedContext: args.simulatedContext,
    },
    date: targetPlainDate,
    ...(args.enforceFutureOnly !== undefined && {
      enforceFutureOnly: args.enforceFutureOnly,
    }),
    ...(defaultLocationId && { locationId: defaultLocationId }),
    practice,
    ruleSetId,
    scope: appointmentScope,
  });
  const candidateSlots = evaluation.slots;
  const blockedSlotsForDay = evaluation.manualBlockedSlots;

  log.push(
    `Found ${evaluation.diagnostics.manualBlocksFound} blocked slots for this day`,
    `Found ${evaluation.diagnostics.practitionersFound} practitioners`,
    `Found ${evaluation.diagnostics.locationsFound} locations`,
    ...(evaluation.diagnostics.slotsPastFiltered > 0
      ? [
          `Filtered past slots: ${evaluation.diagnostics.slotsPastFiltered} removed`,
        ]
      : []),
    `Generated ${evaluation.diagnostics.candidateSlotsGenerated} candidate slots`,
    "Marked slots blocked by vacations",
    "Marked slots blocked by manual blocks",
    `Loaded ${evaluation.diagnostics.rulesLoaded} rules with ${evaluation.diagnostics.ruleConditionsLoaded} total conditions`,
    `Pre-loaded ${evaluation.diagnostics.appointmentsPreloaded} appointments for rule evaluation`,
    "Marked slots blocked by existing appointments",
    ...(evaluation.diagnostics.dayInvariantRulesEvaluated > 0
      ? [
          `Pre-evaluated ${evaluation.diagnostics.dayInvariantRulesEvaluated} day-invariant rules: ${evaluation.diagnostics.dayInvariantRulesBlocked} blocking`,
        ]
      : []),
    `Rules blocked ${evaluation.diagnostics.rulesBlocked} slots`,
  );

  // Return final results
  const finalSlots: InternalSchedulingResultSlot[] = candidateSlots.map(
    (slot) => {
      const slotResult: InternalSchedulingResultSlot = {
        duration: slot.duration,
        locationLineageKey: slot.locationLineageKey,
        practitionerLineageKey: slot.practitionerLineageKey,
        practitionerName: slot.displayReferences.practitionerName,
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
    `Final result: ${evaluation.diagnostics.slotsAvailable} available slots, ${evaluation.diagnostics.slotsBlocked} blocked slots`,
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
    const effectiveRuleSetId = await resolveSchedulingRuleSetId(ctx.db, {
      practiceId: args.practiceId,
      ...(args.ruleSetId ? { preferredRuleSetId: args.ruleSetId } : {}),
    });

    if (!effectiveRuleSetId) {
      return asAvailableSlotsResult({ log: [], slots: [] });
    }

    return asAvailableSlotsResult(
      toPublicSchedulingResult({
        ...(await getSlotsForDayImpl(ctx, {
          ...args,
          date: asIsoDateString(args.date),
          ruleSetId: effectiveRuleSetId,
          simulatedContext: asSimulatedContextInput(args.simulatedContext),
        })),
      }),
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
    const effectiveRuleSetId = await resolveSchedulingRuleSetId(ctx.db, {
      practiceId: args.practiceId,
      ...(args.ruleSetId ? { preferredRuleSetId: args.ruleSetId } : {}),
    });

    if (!effectiveRuleSetId) {
      return null;
    }

    const appointmentTypeLineageKey =
      simulatedContext.appointmentTypeLineageKey;
    if (!appointmentTypeLineageKey) {
      throw new Error(
        "appointmentTypeLineageKey is required in simulatedContext for scheduling queries",
      );
    }

    const appointmentTypeId = await resolveAppointmentTypeIdForRuleSetByLineage(
      ctx.db,
      {
        lineageKey: asAppointmentTypeLineageKey(appointmentTypeLineageKey),
        ruleSetId: effectiveRuleSetId,
      },
    );

    const appointmentType = requireSchedulableAppointmentType(
      await ctx.db.get("appointmentTypes", appointmentTypeId),
      appointmentTypeId,
    );

    const allowedPractitionerLineageKeys = new Set(
      appointmentType.allowedPractitionerLineageKeys.map(
        (practitionerLineageKey) =>
          asPractitionerLineageKey(practitionerLineageKey),
      ),
    );
    const selectedLocationLineageKey =
      simulatedContext.locationLineageKey === undefined
        ? null
        : asLocationLineageKey(simulatedContext.locationLineageKey);
    const startDate = Temporal.PlainDate.from(date);
    const maxSearchDays = 90;

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

          if (
            !allowedPractitionerLineageKeys.has(
              asPractitionerLineageKey(schedule.practitionerLineageKey),
            )
          ) {
            return false;
          }

          if (
            selectedLocationLineageKey &&
            schedule.locationLineageKey !== selectedLocationLineageKey
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
              allowedPractitionerLineageKeys.has(
                asPractitionerLineageKey(slot.practitionerLineageKey),
              ),
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
    ruleSetId ||= await requireActiveRuleSetId(ctx.db, args.practiceId);

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
    const displayReferenceMaps = await loadSchedulingDisplayReferenceMaps(
      ctx.db,
      {
        practiceId: args.practiceId,
        ruleSetId,
      },
    );

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

    const conditionsMap = new Map<Id<"ruleConditions">, Doc<"ruleConditions">>(
      rulesResultRaw.conditions.map((condition) => [condition._id, condition]),
    );

    const rulesData = {
      conditions: rulesResultRaw.conditions,
      conditionsMap,
      rules: rulesResultRaw.rules,
    };

    // Build preloaded appointment data for rule evaluations
    const dayStr = targetPlainDate.toString();
    const preloadedData = await buildPreloadedDayData(
      ctx.db,
      args.practiceId,
      dayStr,
      ruleSetId,
      await ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
        .collect(),
    );

    for (const slot of candidateSlots) {
      if (slot.status === "BLOCKED") {
        continue;
      }
      const displayReferences = resolveSchedulingDisplayReferences(
        displayReferenceMaps,
        slot,
      );
      const appointmentContext: AppointmentContext = {
        dateTime: asZonedDateTimeString(slot.startTime),
        locationId: displayReferences.locationId,
        practiceId: args.practiceId,
        practitionerId: displayReferences.practitionerId,
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
        const displayReferences = resolveSchedulingDisplayReferences(
          displayReferenceMaps,
          slot,
        );
        const result: {
          blockedByBlockedSlotId?: Id<"blockedSlots">;
          blockedByRuleId?: Id<"ruleConditions">;
          duration: number;
          locationId: Id<"locations">;
          locationLineageKey: LocationLineageKey;
          practitionerId: Id<"practitioners">;
          practitionerLineageKey: PractitionerLineageKey;
          reason?: string;
          startTime: string;
          status: "BLOCKED";
        } = {
          duration: slot.duration,
          locationId: displayReferences.locationId,
          locationLineageKey: slot.locationLineageKey,
          practitionerId: displayReferences.practitionerId,
          practitionerLineageKey: slot.practitionerLineageKey,
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
        locationLineageKey: v.id("locations"),
        practitionerId: v.id("practitioners"),
        practitionerLineageKey: v.id("practitioners"),
        reason: v.optional(v.string()),
        startTime: v.string(),
        status: v.literal("BLOCKED"),
      }),
    ),
  }),
});
