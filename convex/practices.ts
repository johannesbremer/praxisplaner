import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Practice management functions

/** Get practice by ID */
export const getPractice = query({
  args: { practiceId: v.id("practices") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.practiceId);
  },
});

/** Create a new practice */
export const createPractice = mutation({
  args: {
    name: v.string(),
    settings: v.optional(v.object({
      defaultSlotDuration: v.optional(v.number()),
      workingHours: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
    })),
  },
  returns: v.id("practices"),
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());
    
    return await ctx.db.insert("practices", {
      name: args.name,
      settings: args.settings,
      createdAt: now,
      lastModified: now,
    });
  },
});

/** Update practice settings */
export const updatePractice = mutation({
  args: {
    practiceId: v.id("practices"),
    name: v.optional(v.string()),
    settings: v.optional(v.object({
      defaultSlotDuration: v.optional(v.number()),
      workingHours: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { practiceId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );
    
    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(practiceId, {
        ...filteredUpdates,
        lastModified: BigInt(Date.now()),
      });
    }
    
    return null;
  },
});

// Base availability management functions

/** Get base availability for a practice and doctor */
export const getBaseAvailability = query({
  args: { 
    practiceId: v.id("practices"),
    doctorId: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("baseAvailability")
      .withIndex("by_practice_and_doctor", (q) =>
        q.eq("practiceId", args.practiceId)
      );
    
    if (args.doctorId) {
      query = query.filter((q) => q.eq(q.field("doctorId"), args.doctorId));
    }
    
    return await query.collect();
  },
});

/** Create base availability schedule */
export const createBaseAvailability = mutation({
  args: {
    practiceId: v.id("practices"),
    doctorId: v.string(),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    slotDuration: v.number(),
    breakTimes: v.optional(v.array(v.object({
      start: v.string(),
      end: v.string(),
    }))),
  },
  returns: v.id("baseAvailability"),
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());
    
    return await ctx.db.insert("baseAvailability", {
      ...args,
      createdAt: now,
      lastModified: now,
    });
  },
});

/** Update base availability */
export const updateBaseAvailability = mutation({
  args: {
    availabilityId: v.id("baseAvailability"),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    slotDuration: v.optional(v.number()),
    breakTimes: v.optional(v.array(v.object({
      start: v.string(),
      end: v.string(),
    }))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { availabilityId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );
    
    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(availabilityId, {
        ...filteredUpdates,
        lastModified: BigInt(Date.now()),
      });
    }
    
    return null;
  },
});

/** Delete base availability */
export const deleteBaseAvailability = mutation({
  args: { availabilityId: v.id("baseAvailability") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.availabilityId);
    return null;
  },
});

// Appointment types management

/** Get appointment types for a practice */
export const getAppointmentTypes = query({
  args: { practiceId: v.id("practices") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("appointmentTypes")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("active", true)
      )
      .collect();
  },
});

/** Create appointment type */
export const createAppointmentType = mutation({
  args: {
    practiceId: v.id("practices"),
    name: v.string(),
    defaultDuration: v.number(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    requiresResources: v.optional(v.array(v.string())),
  },
  returns: v.id("appointmentTypes"),
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());
    
    return await ctx.db.insert("appointmentTypes", {
      ...args,
      active: true,
      createdAt: now,
      lastModified: now,
    });
  },
});