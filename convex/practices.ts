import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// Practice management functions

/** Get practice by ID */
export const getPractice = query({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.practiceId);
  },
  returns: v.union(v.any(), v.null()),
});

/** Create a new practice */
export const createPractice = mutation({
  args: {
    name: v.string(),
    settings: v.optional(
      v.object({
        defaultSlotDuration: v.optional(v.number()),
        workingHours: v.optional(
          v.object({
            end: v.string(),
            start: v.string(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());

    const insertData: {
      createdAt: bigint;
      lastModified: bigint;
      name: string;
      settings?: typeof args.settings;
    } = {
      createdAt: now,
      lastModified: now,
      name: args.name,
    };

    if (args.settings !== undefined) {
      insertData.settings = args.settings;
    }

    return await ctx.db.insert("practices", insertData);
  },
  returns: v.id("practices"),
});

/** Update practice settings */
export const updatePractice = mutation({
  args: {
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
    settings: v.optional(
      v.object({
        defaultSlotDuration: v.optional(v.number()),
        workingHours: v.optional(
          v.object({
            end: v.string(),
            start: v.string(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { practiceId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(practiceId, {
        ...filteredUpdates,
        lastModified: BigInt(Date.now()),
      });
    }

    return null;
  },
  returns: v.null(),
});

// Base availability management functions

/** Get base availability for a practice and doctor */
export const getBaseAvailability = query({
  args: {
    doctorId: v.optional(v.string()),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("baseAvailability")
      .withIndex("by_practice_and_doctor", (q) =>
        q.eq("practiceId", args.practiceId),
      );

    if (args.doctorId) {
      query = query.filter((q) => q.eq(q.field("doctorId"), args.doctorId));
    }

    return await query.collect();
  },
  returns: v.array(v.any()),
});

/** Create base availability schedule */
export const createBaseAvailability = mutation({
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
    doctorId: v.string(),
    endTime: v.string(),
    practiceId: v.id("practices"),
    slotDuration: v.number(),
    startTime: v.string(),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());

    return await ctx.db.insert("baseAvailability", {
      ...args,
      createdAt: now,
      lastModified: now,
    });
  },
  returns: v.id("baseAvailability"),
});

/** Update base availability */
export const updateBaseAvailability = mutation({
  args: {
    availabilityId: v.id("baseAvailability"),
    breakTimes: v.optional(
      v.array(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    ),
    endTime: v.optional(v.string()),
    slotDuration: v.optional(v.number()),
    startTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { availabilityId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(availabilityId, {
        ...filteredUpdates,
        lastModified: BigInt(Date.now()),
      });
    }

    return null;
  },
  returns: v.null(),
});

/** Delete base availability */
export const deleteBaseAvailability = mutation({
  args: { availabilityId: v.id("baseAvailability") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.availabilityId);
    return null;
  },
  returns: v.null(),
});

// Appointment types management

/** Get appointment types for a practice */
export const getAppointmentTypes = query({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("appointmentTypes")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("active", true),
      )
      .collect();
  },
  returns: v.array(v.any()),
});

/** Create appointment type */
export const createAppointmentType = mutation({
  args: {
    color: v.optional(v.string()),
    defaultDuration: v.number(),
    description: v.optional(v.string()),
    name: v.string(),
    practiceId: v.id("practices"),
    requiresResources: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());

    return await ctx.db.insert("appointmentTypes", {
      ...args,
      active: true,
      createdAt: now,
      lastModified: now,
    });
  },
  returns: v.id("appointmentTypes"),
});
