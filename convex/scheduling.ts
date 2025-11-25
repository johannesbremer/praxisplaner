import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import type { AppointmentContext } from "./ruleEngine";

import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import {
  evaluateLoadedRulesHelper,
  preEvaluateDayInvariantRulesHelper,
} from "./ruleEngine";
import {
  availableSlotsResultValidator,
  dateRangeValidator,
  simulatedContextValidator,
} from "./validators";

// Constants
const DEFAULT_SLOT_DURATION_MINUTES = 5;
const TIMEZONE = "Europe/Berlin";

export interface SchedulingResultSlot {
  blockedByBlockedSlotId?: Id<"blockedSlots">; // ID of manual blocked slot that caused this
  blockedByRuleId?: Id<"ruleConditions">;
  duration: number; // minutes
  locationId?: Id<"locations">;
  practitionerId: Id<"practitioners">;
  practitionerName: string;
  reason?: string; // Natural language explanation for blocked slots
  startTime: string; // ISO string
  status: "AVAILABLE" | "BLOCKED";
}

/**
 * Internal candidate slot type used during slot generation.
 */
interface CandidateSlot {
  blockedByBlockedSlotId?: string; // ID of manual blocked slot that caused this
  blockedByRuleId?: string;
  duration: number;
  locationId?: string;
  practitionerId: string;
  practitionerName?: string; // Optional during generation, required in final result
  startTime: string;
  status: "AVAILABLE" | "BLOCKED";
}

/**
 * Shared helper to generate candidate slots for a given day.
 * Reduces code duplication between getSlotsForDay and getBlockedSlotsWithoutAppointmentType.
 * @returns Array of candidate slots with their initial status (before rule evaluation)
 */
async function generateCandidateSlotsForDay(
  db: DatabaseReader,
  args: {
    date: Temporal.PlainDate;
    locationId?: Id<"locations">;
    practiceId: Id<"practices">;
  },
): Promise<CandidateSlot[]> {
  const { date: targetPlainDate, locationId, practiceId } = args;

  // Fetch practitioners for this practice
  const practitioners = await db
    .query("practitioners")
    .withIndex("by_practiceId", (q) => q.eq("practiceId", practiceId))
    .collect();

  // Fetch locations if needed
  const locations = await db
    .query("locations")
    .withIndex("by_practiceId", (q) => q.eq("practiceId", practiceId))
    .collect();

  let defaultLocationId: string | undefined = locationId;
  if (!defaultLocationId && locations.length > 0) {
    defaultLocationId = locations[0]?._id;
  }

  const candidateSlots: CandidateSlot[] = [];

  // Get day of week from Temporal (Monday = 1, Sunday = 7) and convert to JS (Sunday = 0, Monday = 1)
  const dayOfWeek =
    targetPlainDate.dayOfWeek === 7 ? 0 : targetPlainDate.dayOfWeek;

  for (const practitioner of practitioners) {
    const schedules = await db
      .query("baseSchedules")
      .withIndex("by_practitionerId", (q) =>
        q.eq("practitionerId", practitioner._id),
      )
      .filter((q) => {
        if (locationId) {
          return q.eq(q.field("locationId"), locationId);
        }
        return true;
      })
      .collect();

    const schedule = schedules.find((s) => s.dayOfWeek === dayOfWeek);

    if (schedule) {
      const scheduleStartTime = Temporal.PlainTime.from(
        `${schedule.startTime}:00`,
      );
      const scheduleEndTime = Temporal.PlainTime.from(`${schedule.endTime}:00`);

      const scheduleStart = targetPlainDate
        .toZonedDateTime({
          plainTime: scheduleStartTime,
          timeZone: TIMEZONE,
        })
        .toInstant();

      const scheduleEnd = targetPlainDate
        .toZonedDateTime({
          plainTime: scheduleEndTime,
          timeZone: TIMEZONE,
        })
        .toInstant();

      const slotDuration = DEFAULT_SLOT_DURATION_MINUTES;
      const slotDurationMillis = slotDuration * 60 * 1000;

      let currentInstant = scheduleStart;
      while (Temporal.Instant.compare(currentInstant, scheduleEnd) < 0) {
        const slotZoned = currentInstant.toZonedDateTimeISO(TIMEZONE);
        const timeString = `${slotZoned.hour.toString().padStart(2, "0")}:${slotZoned.minute.toString().padStart(2, "0")}`;

        const isBreakTime =
          schedule.breakTimes?.some(
            (breakTime) =>
              timeString >= breakTime.start && timeString < breakTime.end,
          ) ?? false;

        if (!isBreakTime) {
          candidateSlots.push({
            duration: slotDuration,
            ...(defaultLocationId && { locationId: defaultLocationId }),
            practitionerId: practitioner._id,
            practitionerName: practitioner.name,
            startTime: currentInstant.toString(),
            status: "AVAILABLE",
          });
        }

        currentInstant = currentInstant.add({
          milliseconds: slotDurationMillis,
        });
      }
    }
  }

  return candidateSlots;
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
    const availableDates = new Set<string>();

    // Fetch practitioners for this practice
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const startDate = new Date(args.dateRange.start);
    const endDate = new Date(args.dateRange.end);

    for (const practitioner of practitioners) {
      // Get base schedules for this practitioner
      const schedules = await ctx.db
        .query("baseSchedules")
        .withIndex("by_practitionerId", (q) =>
          q.eq("practitionerId", practitioner._id),
        )
        .collect();

      // Filter in code for location (more efficient than .filter())
      const filteredSchedules = args.simulatedContext.locationId
        ? schedules.filter(
            (s) => s.locationId === args.simulatedContext.locationId,
          )
        : schedules;

      // Check each day in the range
      for (
        let currentDate = new Date(startDate);
        currentDate <= endDate;
        currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000)
      ) {
        const dayOfWeek = currentDate.getDay();
        const hasSchedule = filteredSchedules.some(
          (s) => s.dayOfWeek === dayOfWeek,
        );

        if (hasSchedule) {
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
export const getSlotsForDay = query({
  args: {
    date: v.string(), // ISO date string for the specific day (e.g., "2025-10-21")
    practiceId: v.id("practices"),
    ruleSetId: v.optional(v.id("ruleSets")),
    simulatedContext: simulatedContextValidator,
  },
  handler: async (ctx, args) => {
    // Ensure appointmentTypeId is present for rule evaluation
    if (!args.simulatedContext.appointmentTypeId) {
      throw new Error(
        "appointmentTypeId is required in simulatedContext for scheduling queries",
      );
    }

    // Parse the date directly as a Temporal.PlainDate to avoid timezone issues
    const targetPlainDate = Temporal.PlainDate.from(args.date);

    const log: string[] = [`Getting slots for single day: ${args.date}`];

    // Fetch blocked slots for this practice and date using efficient date range query
    const dayStart = targetPlainDate
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: TIMEZONE,
      })
      .toString();

    const dayEnd = targetPlainDate
      .add({ days: 1 })
      .toZonedDateTime({
        plainTime: Temporal.PlainTime.from("00:00"),
        timeZone: TIMEZONE,
      })
      .toString();

    const allBlockedSlots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_practiceId_start", (q) =>
        q.eq("practiceId", args.practiceId).gte("start", dayStart),
      )
      .filter((q) => q.lt(q.field("start"), dayEnd))
      .collect();

    // Determine if we're in simulation mode based on context presence
    const isSimulationMode = !!args.simulatedContext.appointmentTypeId;

    // Filter blocked slots by simulation scope
    const blockedSlotsForDay = allBlockedSlots.filter((blockedSlot) => {
      // In simulation mode, include both real and simulated blocked slots
      // In real mode, only include real blocked slots
      return isSimulationMode ? true : !blockedSlot.isSimulation;
    });

    log.push(`Found ${blockedSlotsForDay.length} blocked slots for this day`);

    // Determine which rule set to use
    let ruleSetId = args.ruleSetId;
    if (!ruleSetId) {
      const practice = await ctx.db.get(args.practiceId);
      if (practice?.currentActiveRuleSetId) {
        ruleSetId = practice.currentActiveRuleSetId;
      } else {
        log.push("No active rule set found, no rules will be applied");
        ruleSetId = undefined;
      }
    }

    if (ruleSetId) {
      log.push(`Using rule set: ${ruleSetId}`);
    }

    // Fetch relevant practitioners
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    log.push(`Found ${practitioners.length} practitioners`);

    // Fetch available locations
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

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
    const candidateSlots = await generateCandidateSlotsForDay(ctx.db, {
      date: targetPlainDate,
      ...(defaultLocationId && { locationId: defaultLocationId }),
      practiceId: args.practiceId,
    });

    log.push(`Generated ${candidateSlots.length} candidate slots`);

    // Mark manually blocked slots
    for (const slot of candidateSlots) {
      const slotInstant = Temporal.Instant.from(slot.startTime);
      const slotEndInstant = slotInstant.add({
        milliseconds: slot.duration * 60 * 1000,
      });

      // Check if this slot overlaps with any blocked slot
      const blockingSlot = blockedSlotsForDay.find((blockedSlot) => {
        const blockedStart = Temporal.Instant.from(blockedSlot.start);
        const blockedEnd = Temporal.Instant.from(blockedSlot.end);

        // Check practitioner match (if blocked slot has practitioner specified)
        if (
          blockedSlot.practitionerId &&
          blockedSlot.practitionerId !== slot.practitionerId
        ) {
          return false;
        }

        // Check if times overlap
        const overlapStart = Temporal.Instant.compare(slotInstant, blockedEnd);
        const overlapEnd = Temporal.Instant.compare(
          slotEndInstant,
          blockedStart,
        );

        return overlapStart < 0 && overlapEnd > 0;
      });

      if (blockingSlot) {
        slot.status = "BLOCKED";
        slot.blockedByBlockedSlotId = blockingSlot._id;
      }
    }

    log.push(`Marked slots blocked by manual blocks`);

    // Apply rules
    if (ruleSetId) {
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
      const conditionsMap = new Map<
        Id<"ruleConditions">,
        Doc<"ruleConditions">
      >(
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

      // Pre-evaluate day-invariant rules once for the entire day
      // Use the simulatedContext since appointmentTypeId and locationId are fixed for the entire query
      let preEvaluatedDayRules;
      if (rulesData.dayInvariantCount > 0 && candidateSlots.length > 0) {
        const firstSlot = candidateSlots[0];
        if (firstSlot) {
          const dayContext = {
            appointmentTypeId,
            dateTime: firstSlot.startTime, // Any slot time works for day-invariant rules
            practiceId: args.practiceId,
            // Note: We use the first slot's practitionerId here, but PRACTITIONER conditions
            // should NOT be in the day-invariant set since practitionerId varies per slot
            practitionerId: firstSlot.practitionerId as Id<"practitioners">,
            requestedAt:
              args.simulatedContext.requestedAt ?? new Date().toISOString(),
            // locationId comes from simulatedContext (fixed for entire query) or slot's default
            ...(args.simulatedContext.locationId && {
              locationId: args.simulatedContext.locationId,
            }),
            ...(!args.simulatedContext.locationId &&
              firstSlot.locationId && {
                locationId: firstSlot.locationId as Id<"locations">,
              }),
          };

          // PERFORMANCE: Call helper directly to avoid serialization overhead
          preEvaluatedDayRules = await preEvaluateDayInvariantRulesHelper(
            ctx.db,
            dayContext,
            rulesData,
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
          practiceId: args.practiceId,
          practitionerId: slot.practitionerId as Id<"practitioners">,
          requestedAt:
            args.simulatedContext.requestedAt ?? new Date().toISOString(),
          ...(slot.locationId && {
            locationId: slot.locationId as Id<"locations">,
          }),
        };

        // PERFORMANCE: Call helper directly to avoid serialization overhead
        const ruleCheckResult = await evaluateLoadedRulesHelper(
          ctx.db,
          appointmentContext,
          rulesData,
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
    } else {
      log.push("No rule set active - all slots remain available");
    }

    // Return final results
    const finalSlots: SchedulingResultSlot[] = candidateSlots.map((slot) => {
      const slotResult: SchedulingResultSlot = {
        duration: slot.duration,
        practitionerId: slot.practitionerId as Id<"practitioners">,
        practitionerName: slot.practitionerName ?? "Unknown Practitioner",
        startTime: slot.startTime,
        status: slot.status,
      };

      if (slot.blockedByBlockedSlotId) {
        slotResult.blockedByBlockedSlotId =
          slot.blockedByBlockedSlotId as Id<"blockedSlots">;
      }

      if (slot.blockedByRuleId) {
        slotResult.blockedByRuleId =
          slot.blockedByRuleId as Id<"ruleConditions">;
      }

      if (slot.locationId) {
        slotResult.locationId = slot.locationId as Id<"locations">;
      }

      return slotResult;
    });

    // Generate natural language reasons for blocked slots
    // TODO: Implement full tree reconstruction and detailed rule descriptions
    // Add natural language description to blocked slots
    for (const slot of finalSlots) {
      if (slot.status === "BLOCKED") {
        // Handle manual blocked slots
        if (slot.blockedByBlockedSlotId) {
          // Find the blocked slot to get its title for the reason
          const blockedSlot = blockedSlotsForDay.find(
            (bs) => bs._id === slot.blockedByBlockedSlotId,
          );
          slot.reason = blockedSlot?.title || "Manuell blockierter Zeitraum";
        } else if (slot.blockedByRuleId) {
          // Handle rule-based blocked slots
          try {
            // Use getRuleDescription to get the tree structure description
            const ruleDescription = await ctx.runQuery(
              internal.ruleEngine.getRuleDescription,
              { ruleId: slot.blockedByRuleId },
            );
            slot.reason =
              ruleDescription.treeStructure.trim() ||
              "Dieser Zeitfenster ist durch eine Regel blockiert.";
          } catch (error) {
            // Fallback if we can't generate a reason
            slot.reason = "Dieser Zeitfenster ist durch eine Regel blockiert.";
            log.push(
              `Failed to generate reason for blocked slot: ${error instanceof Error ? error.message : "unknown error"}`,
            );
          }
        }
      }
    }

    log.push(
      `Final result: ${finalSlots.filter((s) => s.status === "AVAILABLE").length} available slots, ${finalSlots.filter((s) => s.status === "BLOCKED").length} blocked slots`,
    );

    return { log, slots: finalSlots };
  },
  returns: availableSlotsResultValidator,
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
    const targetPlainDate = Temporal.PlainDate.from(args.date);

    // Determine which rule set to use
    let ruleSetId = args.ruleSetId;
    if (!ruleSetId) {
      const practice = await ctx.db.get(args.practiceId);
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
        practiceId: args.practiceId,
        practitionerId: slot.practitionerId as Id<"practitioners">,
        requestedAt: new Date().toISOString(),
        ...(slot.locationId && {
          locationId: slot.locationId as Id<"locations">,
        }),
      };

      const ruleCheckResult = await evaluateLoadedRulesHelper(
        ctx.db,
        appointmentContext,
        rulesData, // No pre-evaluated rules
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

    // Return only blocked slots
    const blockedSlots = candidateSlots
      .filter((slot) => slot.status === "BLOCKED")
      .map((slot) => {
        const result: {
          blockedByBlockedSlotId?: Id<"blockedSlots">;
          blockedByRuleId?: Id<"ruleConditions">;
          duration: number;
          locationId?: Id<"locations">;
          practitionerId: Id<"practitioners">;
          startTime: string;
          status: "BLOCKED";
        } = {
          duration: slot.duration,
          practitionerId: slot.practitionerId as Id<"practitioners">,
          startTime: slot.startTime,
          status: "BLOCKED" as const,
        };

        if (slot.blockedByBlockedSlotId) {
          result.blockedByBlockedSlotId =
            slot.blockedByBlockedSlotId as Id<"blockedSlots">;
        }

        if (slot.blockedByRuleId) {
          result.blockedByRuleId = slot.blockedByRuleId as Id<"ruleConditions">;
        }

        if (slot.locationId) {
          result.locationId = slot.locationId as Id<"locations">;
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
        locationId: v.optional(v.id("locations")),
        practitionerId: v.id("practitioners"),
        startTime: v.string(),
        status: v.literal("BLOCKED"),
      }),
    ),
  }),
});
