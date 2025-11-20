import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";

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
    let defaultLocationId: string | undefined;
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

    // Generate candidate slots for the single day
    const candidateSlots: {
      blockedByRuleId?: string;
      duration: number;
      locationId?: string;
      practitionerId: string;
      practitionerName: string;
      startTime: string;
      status: "AVAILABLE" | "BLOCKED";
    }[] = [];

    // Get day of week from Temporal (Monday = 1, Sunday = 7) and convert to JS (Sunday = 0, Monday = 1)
    const dayOfWeek =
      targetPlainDate.dayOfWeek === 7 ? 0 : targetPlainDate.dayOfWeek;

    for (const practitioner of practitioners) {
      const schedules = await ctx.db
        .query("baseSchedules")
        .withIndex("by_practitionerId", (q) =>
          q.eq("practitionerId", practitioner._id),
        )
        .filter((q) => {
          if (args.simulatedContext.locationId) {
            return q.eq(
              q.field("locationId"),
              args.simulatedContext.locationId,
            );
          }
          return true;
        })
        .collect();

      log.push(
        `Practitioner ${practitioner.name}: Found ${schedules.length} schedules` +
          (args.simulatedContext.locationId
            ? ` for location ${args.simulatedContext.locationId}`
            : " (all locations)"),
      );

      const schedule = schedules.find((s) => s.dayOfWeek === dayOfWeek);

      if (schedule) {
        const [startHour, startMinute] = schedule.startTime
          .split(":")
          .map(Number);
        const [endHour, endMinute] = schedule.endTime.split(":").map(Number);

        if (
          startHour === undefined ||
          startMinute === undefined ||
          endHour === undefined ||
          endMinute === undefined
        ) {
          continue;
        }

        // Parse the schedule times in Berlin timezone
        const scheduleStartTime = Temporal.PlainTime.from(
          `${schedule.startTime}:00`,
        );
        const scheduleEndTime = Temporal.PlainTime.from(
          `${schedule.endTime}:00`,
        );

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
          // Convert to Berlin time for break time checking
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

          // Advance to next slot
          currentInstant = currentInstant.add({
            milliseconds: slotDurationMillis,
          });
        }
      }
    }

    log.push(`Generated ${candidateSlots.length} candidate slots`);

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
        practitionerName: slot.practitionerName,
        startTime: slot.startTime,
        status: slot.status,
      };

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
      if (slot.status === "BLOCKED" && slot.blockedByRuleId) {
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

    log.push(
      `Final result: ${finalSlots.filter((s) => s.status === "AVAILABLE").length} available slots, ${finalSlots.filter((s) => s.status === "BLOCKED").length} blocked slots`,
    );

    return { log, slots: finalSlots };
  },
  returns: availableSlotsResultValidator,
});
