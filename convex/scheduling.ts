import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { internal } from "./_generated/api";
import { query } from "./_generated/server";
import {
  availableSlotsResultValidator,
  dateRangeValidator,
  simulatedContextValidator,
} from "./validators";

// Constants
const DEFAULT_SLOT_DURATION_MINUTES = 5;

interface SchedulingResultSlot {
  blockedByRuleId?: Id<"ruleConditions">; // Changed from "rules" to "ruleConditions"
  duration: number;
  locationId?: Id<"locations">;
  practitionerId: Id<"practitioners">;
  practitionerName: string;
  startTime: string;
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
        .filter((q) => {
          // If a location is specified, only get schedules for that location
          if (args.simulatedContext.locationId) {
            return q.eq(
              q.field("locationId"),
              args.simulatedContext.locationId,
            );
          }
          return true;
        })
        .collect();

      // Check each day in the range
      for (
        let currentDate = new Date(startDate);
        currentDate <= endDate;
        currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000)
      ) {
        const dayOfWeek = currentDate.getDay();
        const hasSchedule = schedules.some((s) => s.dayOfWeek === dayOfWeek);

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
    // Parse the date and create a single-day range
    const dayStart = new Date(args.date);
    dayStart.setUTCHours(0, 0, 0, 0);

    const dayEnd = new Date(dayStart);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const log: string[] = [];
    log.push(`Getting slots for single day: ${args.date}`);

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

    const targetDate = new Date(dayStart);

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

      const dayOfWeek = targetDate.getDay();
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

        const scheduleStart = new Date(targetDate);
        scheduleStart.setUTCHours(startHour, startMinute, 0, 0);

        const scheduleEnd = new Date(targetDate);
        scheduleEnd.setUTCHours(endHour, endMinute, 0, 0);

        const slotDuration = DEFAULT_SLOT_DURATION_MINUTES;
        for (
          let slotTime = new Date(scheduleStart);
          slotTime < scheduleEnd;
          slotTime = new Date(slotTime.getTime() + slotDuration * 60 * 1000)
        ) {
          const timeString = `${slotTime.getUTCHours().toString().padStart(2, "0")}:${slotTime.getUTCMinutes().toString().padStart(2, "0")}`;
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
              startTime: slotTime.toISOString(),
              status: "AVAILABLE",
            });
          }
        }
      }
    }

    log.push(`Generated ${candidateSlots.length} candidate slots`);

    // Apply rules
    if (ruleSetId) {
      let totalBlockedCount = 0;

      for (const slot of candidateSlots) {
        if (slot.status === "BLOCKED") {
          continue;
        }

        const appointmentContext = {
          appointmentTypeId: args.simulatedContext.appointmentTypeId,
          dateTime: slot.startTime,
          practiceId: args.practiceId,
          practitionerId: slot.practitionerId as Id<"practitioners">,
          requestedAt: new Date().toISOString(),
          ...(slot.locationId && {
            locationId: slot.locationId as Id<"locations">,
          }),
        };

        const ruleCheckResult = await ctx.runQuery(
          internal.ruleEngine.checkRulesForAppointment,
          {
            context: appointmentContext,
            ruleSetId,
          },
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

    log.push(
      `Final result: ${finalSlots.filter((s) => s.status === "AVAILABLE").length} available slots, ${finalSlots.filter((s) => s.status === "BLOCKED").length} blocked slots`,
    );

    return { log, slots: finalSlots };
  },
  returns: availableSlotsResultValidator,
});
