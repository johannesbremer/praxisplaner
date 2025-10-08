// convex/baseSchedules.ts
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import {
  canModifyDirectly,
  validateEntityBelongsToRuleSet,
  validateRuleSetBelongsToPractice,
} from "./ruleSetValidation";
import { breakTimesValidator } from "./validators";

// Helper function to parse time string to minutes
function timeToMinutes(time: string): number {
  const parts = time.split(":");
  const hours = parts[0];
  const minutes = parts[1];
  if (!hours || !minutes) {
    throw new Error("Invalid time format");
  }
  return Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10);
}

export const createBaseSchedule = mutation({
  args: {
    breakTimes: breakTimesValidator,
    dayOfWeek: v.number(),
    endTime: v.string(),
    locationId: v.id("locations"),
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
    startTime: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate day of week
    if (args.dayOfWeek < 0 || args.dayOfWeek > 6) {
      throw new Error(
        "Day of week must be between 0 (Sunday) and 6 (Saturday)",
      );
    }

    // Validate time format (HH:MM)
    const timeRegex = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
    if (!timeRegex.test(args.startTime) || !timeRegex.test(args.endTime)) {
      throw new Error("Time must be in HH:MM format");
    }

    // Validate that start time is before end time
    const startMinutes = timeToMinutes(args.startTime);
    const endMinutes = timeToMinutes(args.endTime);

    if (startMinutes >= endMinutes) {
      throw new Error("Start time must be before end time");
    }

    // Validate break times
    if (args.breakTimes) {
      for (const breakTime of args.breakTimes) {
        if (
          !timeRegex.test(breakTime.start) ||
          !timeRegex.test(breakTime.end)
        ) {
          throw new Error("Break times must be in HH:MM format");
        }

        const breakStartMinutes = timeToMinutes(breakTime.start);
        const breakEndMinutes = timeToMinutes(breakTime.end);

        if (breakStartMinutes >= breakEndMinutes) {
          throw new Error("Break start time must be before break end time");
        }

        if (breakStartMinutes < startMinutes || breakEndMinutes > endMinutes) {
          throw new Error("Break times must be within the working hours");
        }
      }
    }

    // Check if practitioner exists
    const practitioner = await ctx.db.get(args.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    // Verify the rule set exists and belongs to the same practice
    await validateRuleSetBelongsToPractice(
      ctx,
      args.ruleSetId,
      practitioner.practiceId,
    );

    // Check if schedule already exists for this practitioner and day in this rule set
    const existingSchedule = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("practitionerId", args.practitionerId),
      )
      .filter((q) => q.eq(q.field("dayOfWeek"), args.dayOfWeek))
      .first();

    if (existingSchedule) {
      throw new Error(
        `Schedule already exists for this day. Please update or delete the existing schedule first.`,
      );
    }

    const insertData: {
      breakTimes?: { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      locationId: Id<"locations">;
      practitionerId: Id<"practitioners">;
      ruleSetId: Id<"ruleSets">;
      startTime: string;
    } = {
      dayOfWeek: args.dayOfWeek,
      endTime: args.endTime,
      locationId: args.locationId,
      practitionerId: args.practitionerId,
      ruleSetId: args.ruleSetId,
      startTime: args.startTime,
    };

    if (args.breakTimes !== undefined) {
      insertData.breakTimes = args.breakTimes;
    }

    const scheduleId = await ctx.db.insert("baseSchedules", insertData);
    return scheduleId;
  },
  returns: v.id("baseSchedules"),
});

export const updateBaseSchedule = mutation({
  args: {
    breakTimes: v.optional(breakTimesValidator),
    endTime: v.optional(v.string()),
    id: v.id("baseSchedules"),
    locationId: v.optional(v.id("locations")),
    ruleSetId: v.id("ruleSets"),
    startTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.id);
    if (!schedule) {
      throw new Error("Schedule not found");
    }

    // Get the practitioner to verify practice ownership
    const practitioner = await ctx.db.get(schedule.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    // Validate the entity and rule set relationship
    await validateEntityBelongsToRuleSet(
      ctx,
      practitioner,
      "baseSchedules",
      args.ruleSetId,
    );

    // Check if we can modify directly or need to copy
    const shouldCopyOnWrite = !canModifyDirectly(
      schedule.ruleSetId,
      args.ruleSetId,
    );

    // Validate time format and logic if provided
    const timeRegex = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;

    const startTime = args.startTime ?? schedule.startTime;
    const endTime = args.endTime ?? schedule.endTime;

    if (args.startTime && !timeRegex.test(args.startTime)) {
      throw new Error("Start time must be in HH:MM format");
    }

    if (args.endTime && !timeRegex.test(args.endTime)) {
      throw new Error("End time must be in HH:MM format");
    }

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    if (startMinutes >= endMinutes) {
      throw new Error("Start time must be before end time");
    }

    // Validate break times if provided
    const breakTimes = args.breakTimes ?? schedule.breakTimes;
    if (breakTimes) {
      for (const breakTime of breakTimes) {
        if (
          !timeRegex.test(breakTime.start) ||
          !timeRegex.test(breakTime.end)
        ) {
          throw new Error("Break times must be in HH:MM format");
        }

        const breakStartMinutes = timeToMinutes(breakTime.start);
        const breakEndMinutes = timeToMinutes(breakTime.end);

        if (breakStartMinutes >= breakEndMinutes) {
          throw new Error("Break start time must be before break end time");
        }

        if (breakStartMinutes < startMinutes || breakEndMinutes > endMinutes) {
          throw new Error("Break times must be within the working hours");
        }
      }
    }

    if (shouldCopyOnWrite) {
      // Create a new version in the target rule set
      const updateData: {
        breakTimes?: { end: string; start: string }[];
        dayOfWeek: number;
        endTime: string;
        locationId: Id<"locations">;
        practitionerId: Id<"practitioners">;
        ruleSetId: Id<"ruleSets">;
        startTime: string;
      } = {
        dayOfWeek: schedule.dayOfWeek,
        endTime,
        locationId: args.locationId ?? schedule.locationId,
        practitionerId: schedule.practitionerId,
        ruleSetId: args.ruleSetId,
        startTime,
      };

      if (breakTimes !== undefined) {
        updateData.breakTimes = breakTimes;
      }

      const newScheduleId = await ctx.db.insert("baseSchedules", updateData);
      return newScheduleId;
    } else {
      // Direct modification in the same rule set
      const patchData: {
        breakTimes?: { end: string; start: string }[];
        endTime?: string;
        locationId?: Id<"locations">;
        startTime?: string;
      } = {};

      if (args.startTime !== undefined) {
        patchData.startTime = args.startTime;
      }
      if (args.endTime !== undefined) {
        patchData.endTime = args.endTime;
      }
      if (args.locationId !== undefined) {
        patchData.locationId = args.locationId;
      }
      if (args.breakTimes !== undefined) {
        patchData.breakTimes = args.breakTimes;
      }

      await ctx.db.patch(args.id, patchData);
      return args.id;
    }
  },
  returns: v.id("baseSchedules"),
});

export const deleteBaseSchedule = mutation({
  args: {
    id: v.id("baseSchedules"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.id);
    if (!schedule) {
      throw new Error("Schedule not found");
    }

    // Get the practitioner to verify practice ownership
    const practitioner = await ctx.db.get(schedule.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    // Validate the entity and rule set relationship
    await validateEntityBelongsToRuleSet(
      ctx,
      practitioner,
      "baseSchedules",
      args.ruleSetId,
    );

    // Check if we can delete directly or need to mark as deleted in the new rule set
    const shouldCopyOnWrite = !canModifyDirectly(
      schedule.ruleSetId,
      args.ruleSetId,
    );

    if (shouldCopyOnWrite) {
      // For copy-on-write, we simply don't create the entity in the new rule set
      // The absence of the entity in the target rule set implies deletion
      return;
    } else {
      // Direct deletion in the same rule set
      await ctx.db.delete(args.id);
    }
  },
  returns: v.null(),
});

/**
 * Get base schedules for a specific practitioner in a specific rule set.
 * Both practitionerId and ruleSetId are required to prevent querying across all rule sets.
 */
export const getBaseSchedulesByPractitioner = query({
  args: {
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("practitionerId", args.practitionerId),
      )
      .collect();

    return schedules.toSorted((a, b) => a.dayOfWeek - b.dayOfWeek);
  },
});

/**
 * Get all base schedules in a specific rule set.
 * ruleSetId is required to prevent querying across all rule sets.
 */
export const getAllBaseSchedules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    // Augment schedules with practitioner and location names
    const schedulesWithNames = await Promise.all(
      schedules.map(async (schedule) => {
        const practitioner = await ctx.db.get(schedule.practitionerId);
        const location = await ctx.db.get(schedule.locationId);
        return {
          ...schedule,
          locationName: location?.name ?? "Unknown",
          practitionerName: practitioner?.name ?? "Unknown",
        };
      }),
    );

    return schedulesWithNames.toSorted((a, b) => a.dayOfWeek - b.dayOfWeek);
  },
});
