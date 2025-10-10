/**
 * Entity Management API
 *
 * Public mutations and queries for managing entities within rule sets.
 * All mutations require an unsaved rule set (saved=false).
 *
 * Entities managed here:
 * - Appointment Types
 * - Practitioners
 * - Locations
 * - Base Schedules
 */

import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { getOrCreateUnsavedRuleSet } from "./copyOnWrite";

// ================================
// APPOINTMENT TYPES
// ================================

/**
 * Create a new appointment type in an unsaved rule set
 */
export const createAppointmentType = mutation({
  args: {
    duration: v.number(), // duration in minutes
    name: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    // Check for name uniqueness within the rule set
    const existing = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .first();

    if (existing) {
      throw new Error(
        "Appointment type with this name already exists in this rule set",
      );
    }

    // Create the appointment type
    return await ctx.db.insert("appointmentTypes", {
      createdAt: BigInt(Date.now()),
      duration: args.duration,
      lastModified: BigInt(Date.now()),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
    });
  },
  returns: v.id("appointmentTypes"),
});

/**
 * Update an appointment type in an unsaved rule set
 */
export const updateAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    duration: v.optional(v.number()),
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    const appointmentType = await ctx.db.get(args.appointmentTypeId);
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    // Verify it belongs to the unsaved rule set
    if (appointmentType.ruleSetId !== ruleSetId) {
      throw new Error(
        "Appointment type does not belong to the unsaved rule set",
      );
    }

    // Check name uniqueness if changing name
    if (args.name !== undefined && args.name !== appointmentType.name) {
      const newName = args.name; // Narrow type for TypeScript
      const existing = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_ruleSetId_name", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("name", newName),
        )
        .first();

      if (existing) {
        throw new Error(
          "Appointment type with this name already exists in this rule set",
        );
      }
    }

    // Update the appointment type
    const updates: Partial<{
      duration: number;
      lastModified: bigint;
      name: string;
    }> = {
      lastModified: BigInt(Date.now()),
    };

    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.duration !== undefined) {
      updates.duration = args.duration;
    }

    await ctx.db.patch(args.appointmentTypeId, updates);
  },
});

/**
 * Delete an appointment type from an unsaved rule set
 */
export const deleteAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    const appointmentType = await ctx.db.get(args.appointmentTypeId);
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    // Verify it belongs to the unsaved rule set
    if (appointmentType.ruleSetId !== ruleSetId) {
      throw new Error(
        "Appointment type does not belong to the unsaved rule set",
      );
    }

    await ctx.db.delete(args.appointmentTypeId);
  },
});

/**
 * Get all appointment types for a rule set
 */
export const getAppointmentTypes = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
  },
});

// ================================
// PRACTITIONERS
// ================================

/**
 * Create a new practitioner in an unsaved rule set
 */
export const createPractitioner = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    // Check for name uniqueness within the rule set
    const existing = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .first();

    if (existing) {
      throw new Error(
        "Practitioner with this name already exists in this rule set",
      );
    }

    // Create the practitioner
    return await ctx.db.insert("practitioners", {
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
      ...(args.tags && { tags: args.tags }),
    });
  },
  returns: v.id("practitioners"),
});

/**
 * Update a practitioner in an unsaved rule set
 */
export const updatePractitioner = mutation({
  args: {
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    const practitioner = await ctx.db.get(args.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    // Verify it belongs to the unsaved rule set
    if (practitioner.ruleSetId !== ruleSetId) {
      throw new Error("Practitioner does not belong to the unsaved rule set");
    }

    // Check name uniqueness if changing name
    if (args.name !== undefined && args.name !== practitioner.name) {
      const newName = args.name; // Narrow type for TypeScript
      const existing = await ctx.db
        .query("practitioners")
        .withIndex("by_ruleSetId_name", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("name", newName),
        )
        .first();

      if (existing) {
        throw new Error(
          "Practitioner with this name already exists in this rule set",
        );
      }
    }

    // Update the practitioner
    const updates: Partial<{ name: string; tags: string[] | undefined }> = {};

    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.tags !== undefined) {
      updates.tags = args.tags;
    }

    await ctx.db.patch(args.practitionerId, updates);
  },
});

/**
 * Delete a practitioner from an unsaved rule set
 */
export const deletePractitioner = mutation({
  args: {
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    const practitioner = await ctx.db.get(args.practitionerId);
    if (!practitioner) {
      throw new Error("Practitioner not found");
    }

    // Verify it belongs to the unsaved rule set
    if (practitioner.ruleSetId !== ruleSetId) {
      throw new Error("Practitioner does not belong to the unsaved rule set");
    }

    // Delete associated base schedules
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("practitionerId", args.practitionerId),
      )
      .collect();

    for (const schedule of schedules) {
      await ctx.db.delete(schedule._id);
    }

    await ctx.db.delete(args.practitionerId);
  },
});

/**
 * Get all practitioners for a rule set
 */
export const getPractitioners = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
  },
});

// ================================
// LOCATIONS
// ================================

/**
 * Create a new location in an unsaved rule set
 */
export const createLocation = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    // Check for name uniqueness within the rule set
    const existing = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .first();

    if (existing) {
      throw new Error(
        "Location with this name already exists in this rule set",
      );
    }

    // Create the location
    return await ctx.db.insert("locations", {
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
    });
  },
  returns: v.id("locations"),
});

/**
 * Update a location in an unsaved rule set
 */
export const updateLocation = mutation({
  args: {
    locationId: v.id("locations"),
    name: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    const location = await ctx.db.get(args.locationId);
    if (!location) {
      throw new Error("Location not found");
    }

    // Verify it belongs to the unsaved rule set
    if (location.ruleSetId !== ruleSetId) {
      throw new Error("Location does not belong to the unsaved rule set");
    }

    // Check name uniqueness if changing name
    if (args.name !== location.name) {
      const existing = await ctx.db
        .query("locations")
        .withIndex("by_ruleSetId_name", (q) =>
          q.eq("ruleSetId", ruleSetId).eq("name", args.name),
        )
        .first();

      if (existing) {
        throw new Error(
          "Location with this name already exists in this rule set",
        );
      }
    }

    // Update the location
    await ctx.db.patch(args.locationId, { name: args.name });
  },
});

/**
 * Delete a location from an unsaved rule set
 */
export const deleteLocation = mutation({
  args: {
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    const location = await ctx.db.get(args.locationId);
    if (!location) {
      throw new Error("Location not found");
    }

    // Verify it belongs to the unsaved rule set
    if (location.ruleSetId !== ruleSetId) {
      throw new Error("Location does not belong to the unsaved rule set");
    }

    // Delete associated base schedules
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_locationId", (q) => q.eq("locationId", args.locationId))
      .collect();

    for (const schedule of schedules) {
      await ctx.db.delete(schedule._id);
    }

    await ctx.db.delete(args.locationId);
  },
});

/**
 * Get all locations for a rule set
 */
export const getLocations = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
  },
});

// ================================
// BASE SCHEDULES
// ================================

/**
 * Create a new base schedule in an unsaved rule set
 */
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
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    startTime: v.string(),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    // Verify practitioner belongs to unsaved rule set
    const practitioner = await ctx.db.get(args.practitionerId);
    if (!practitioner || practitioner.ruleSetId !== ruleSetId) {
      throw new Error("Practitioner does not belong to the unsaved rule set");
    }

    // Verify location belongs to unsaved rule set
    const location = await ctx.db.get(args.locationId);
    if (!location || location.ruleSetId !== ruleSetId) {
      throw new Error("Location does not belong to the unsaved rule set");
    }

    // Create the base schedule
    return await ctx.db.insert("baseSchedules", {
      dayOfWeek: args.dayOfWeek,
      endTime: args.endTime,
      locationId: args.locationId,
      practiceId: args.practiceId,
      practitionerId: args.practitionerId,
      ruleSetId,
      startTime: args.startTime,
      ...(args.breakTimes && { breakTimes: args.breakTimes }),
    });
  },
  returns: v.id("baseSchedules"),
});

/**
 * Update a base schedule in an unsaved rule set
 */
export const updateBaseSchedule = mutation({
  args: {
    baseScheduleId: v.id("baseSchedules"),
    breakTimes: v.optional(
      v.array(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    ),
    dayOfWeek: v.optional(v.number()),
    endTime: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    practiceId: v.id("practices"),
    practitionerId: v.optional(v.id("practitioners")),
    startTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    const schedule = await ctx.db.get(args.baseScheduleId);
    if (!schedule) {
      throw new Error("Base schedule not found");
    }

    // Verify it belongs to the unsaved rule set
    if (schedule.ruleSetId !== ruleSetId) {
      throw new Error("Base schedule does not belong to the unsaved rule set");
    }

    // Verify new practitioner if provided
    if (args.practitionerId) {
      const practitioner = await ctx.db.get(args.practitionerId);
      if (!practitioner || practitioner.ruleSetId !== ruleSetId) {
        throw new Error("Practitioner does not belong to the unsaved rule set");
      }
    }

    // Verify new location if provided
    if (args.locationId) {
      const location = await ctx.db.get(args.locationId);
      if (!location || location.ruleSetId !== ruleSetId) {
        throw new Error("Location does not belong to the unsaved rule set");
      }
    }

    // Update the schedule
    const updates: Partial<{
      breakTimes: undefined | { end: string; start: string }[];
      dayOfWeek: number;
      endTime: string;
      locationId: typeof args.locationId;
      practitionerId: typeof args.practitionerId;
      startTime: string;
    }> = {};

    if (args.dayOfWeek !== undefined) {
      updates.dayOfWeek = args.dayOfWeek;
    }
    if (args.startTime !== undefined) {
      updates.startTime = args.startTime;
    }
    if (args.endTime !== undefined) {
      updates.endTime = args.endTime;
    }
    if (args.practitionerId !== undefined) {
      updates.practitionerId = args.practitionerId;
    }
    if (args.locationId !== undefined) {
      updates.locationId = args.locationId;
    }
    if (args.breakTimes !== undefined) {
      updates.breakTimes = args.breakTimes;
    }

    await ctx.db.patch(args.baseScheduleId, updates);
  },
});

/**
 * Delete a base schedule from an unsaved rule set
 */
export const deleteBaseSchedule = mutation({
  args: {
    baseScheduleId: v.id("baseSchedules"),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    const schedule = await ctx.db.get(args.baseScheduleId);
    if (!schedule) {
      throw new Error("Base schedule not found");
    }

    // Verify it belongs to the unsaved rule set
    if (schedule.ruleSetId !== ruleSetId) {
      throw new Error("Base schedule does not belong to the unsaved rule set");
    }

    await ctx.db.delete(args.baseScheduleId);
  },
});

/**
 * Get all base schedules for a rule set
 */
export const getBaseSchedules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
  },
});

/**
 * Get base schedules for a specific practitioner
 */
export const getBaseSchedulesByPractitioner = query({
  args: {
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("practitionerId", args.practitionerId),
      )
      .collect();
  },
});
