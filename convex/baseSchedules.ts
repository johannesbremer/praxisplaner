// convex/baseSchedules.ts
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

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
    breakTimes: v.optional(
      v.array(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    ),
    dayOfWeek: v.number(),
    endTime: v.string(),
    practitionerId: v.id("practitioners"),
    slotDuration: v.number(),
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

    // Validate slot duration
    if (args.slotDuration <= 0 || args.slotDuration > 480) {
      throw new Error("Slot duration must be between 1 and 480 minutes");
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

    // Check if schedule already exists for this practitioner and day
    const existingSchedule = await ctx.db
      .query("baseSchedules")
      .withIndex("by_practitionerId", (q) =>
        q.eq("practitionerId", args.practitionerId),
      )
      .filter((q) => q.eq(q.field("dayOfWeek"), args.dayOfWeek))
      .first();

    if (existingSchedule) {
      throw new Error(
        `Schedule already exists for this day. Please update or delete the existing schedule first.`,
      );
    }

    const scheduleId = await ctx.db.insert("baseSchedules", args);
    return scheduleId;
  },
  returns: v.id("baseSchedules"),
});

export const updateBaseSchedule = mutation({
  args: {
    breakTimes: v.optional(
      v.array(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    ),
    endTime: v.string(),
    scheduleId: v.id("baseSchedules"),
    slotDuration: v.number(),
    startTime: v.string(),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) {
      throw new Error("Schedule not found");
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

    // Validate slot duration
    if (args.slotDuration <= 0 || args.slotDuration > 480) {
      throw new Error("Slot duration must be between 1 and 480 minutes");
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

    const updateData: {
      breakTimes?: { end: string; start: string }[];
      endTime: string;
      slotDuration: number;
      startTime: string;
    } = {
      endTime: args.endTime,
      slotDuration: args.slotDuration,
      startTime: args.startTime,
    };

    if (args.breakTimes !== undefined) {
      updateData.breakTimes = args.breakTimes;
    }

    await ctx.db.patch(args.scheduleId, updateData);

    return null;
  },
  returns: v.null(),
});

export const deleteBaseSchedule = mutation({
  args: {
    scheduleId: v.id("baseSchedules"),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) {
      throw new Error("Schedule not found");
    }

    await ctx.db.delete(args.scheduleId);
    return null;
  },
  returns: v.null(),
});

export const getBaseSchedulesByPractitioner = query({
  args: {
    practitionerId: v.id("practitioners"),
  },
  handler: async (ctx, args) => {
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_practitionerId", (q) =>
        q.eq("practitionerId", args.practitionerId),
      )
      .collect();

    return schedules.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("baseSchedules"),
      breakTimes: v.optional(
        v.array(
          v.object({
            end: v.string(),
            start: v.string(),
          }),
        ),
      ),
      dayOfWeek: v.number(),
      endTime: v.string(),
      practitionerId: v.id("practitioners"),
      slotDuration: v.number(),
      startTime: v.string(),
    }),
  ),
});

export const getAllBaseSchedules = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get all practitioners for this practice
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    // Get all schedules for these practitioners
    const allSchedules = [];
    for (const practitioner of practitioners) {
      const schedules = await ctx.db
        .query("baseSchedules")
        .withIndex("by_practitionerId", (q) =>
          q.eq("practitionerId", practitioner._id),
        )
        .collect();

      for (const schedule of schedules) {
        allSchedules.push({
          ...schedule,
          practitionerName: practitioner.name,
        });
      }
    }

    return allSchedules.sort((a, b) => {
      // Sort by practitioner name first, then by day of week
      if (a.practitionerName !== b.practitionerName) {
        return a.practitionerName.localeCompare(b.practitionerName);
      }
      return a.dayOfWeek - b.dayOfWeek;
    });
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("baseSchedules"),
      breakTimes: v.optional(
        v.array(
          v.object({
            end: v.string(),
            start: v.string(),
          }),
        ),
      ),
      dayOfWeek: v.number(),
      endTime: v.string(),
      practitionerId: v.id("practitioners"),
      practitionerName: v.string(),
      slotDuration: v.number(),
      startTime: v.string(),
    }),
  ),
});
