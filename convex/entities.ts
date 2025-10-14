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

import type { GenericDatabaseReader } from "convex/server";

import { v } from "convex/values";

import type { DataModel } from "./_generated/dataModel";
import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import {
  getOrCreateUnsavedRuleSet,
  verifyEntityInUnsavedRuleSet,
} from "./copyOnWrite";

// Type alias for cleaner code
type DatabaseReader = GenericDatabaseReader<DataModel>;

// ================================
// SHARED TYPES
// ================================

/**
 * Return type for create mutations that includes both the entity ID
 * and the rule set ID (in case a new unsaved rule set was created)
 */
const createResultValidator = v.object({
  entityId: v.union(
    v.id("appointmentTypes"),
    v.id("practitioners"),
    v.id("locations"),
    v.id("rules"),
    v.id("baseSchedules"),
  ),
  ruleSetId: v.id("ruleSets"),
});

// ================================
// SHARED HELPER FUNCTIONS
// ================================

/**
 * Resolve practitioner IDs to their unsaved rule set versions.
 * Validates that practitioners exist, belong to the practice, and resolves them
 * to their copies in the unsaved rule set.
 * @throws Error if practitionerIds is undefined, empty, or contains invalid practitioners
 * @returns Array of resolved practitioner IDs (never undefined when practitioners are required)
 */
async function resolvePractitionerIds(
  db: DatabaseReader,
  practitionerIds: Id<"practitioners">[] | undefined,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  required: true,
): Promise<Id<"practitioners">[]>;
async function resolvePractitionerIds(
  db: DatabaseReader,
  practitionerIds: Id<"practitioners">[] | undefined,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  required?: false,
): Promise<Id<"practitioners">[] | undefined>;
async function resolvePractitionerIds(
  db: DatabaseReader,
  practitionerIds: Id<"practitioners">[] | undefined,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
  required = false,
): Promise<Id<"practitioners">[] | undefined> {
  if (!practitionerIds) {
    if (required) {
      throw new Error("At least one practitioner must be selected");
    }
    return undefined;
  }

  // Validate at least one practitioner is provided when required
  if (required && practitionerIds.length === 0) {
    throw new Error("At least one practitioner must be selected");
  }

  const seen = new Set<Id<"practitioners">>();
  const resolved: Id<"practitioners">[] = [];

  for (const practitionerId of practitionerIds) {
    const practitionerEntity = await db.get(practitionerId);
    if (!practitionerEntity) {
      throw new Error("Practitioner not found");
    }
    if (practitionerEntity.practiceId !== practiceId) {
      throw new Error("Practitioner does not belong to this practice");
    }

    let unsavedPractitioner = practitionerEntity;
    if (practitionerEntity.ruleSetId !== ruleSetId) {
      const practitionerCopy = await db
        .query("practitioners")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", practitionerEntity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!practitionerCopy) {
        throw new Error(
          "Practitioner not found in unsaved rule set. This should not happen.",
        );
      }

      unsavedPractitioner = practitionerCopy;
    }

    if (!seen.has(unsavedPractitioner._id)) {
      seen.add(unsavedPractitioner._id);
      resolved.push(unsavedPractitioner._id);
    }
  }

  return resolved;
}

// ================================
// APPOINTMENT TYPES
// ================================

/**
 * Create a new appointment type in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
 */
export const createAppointmentType = mutation({
  args: {
    duration: v.number(), // duration in minutes
    name: v.string(),
    practiceId: v.id("practices"),
    practitionerIds: v.array(v.id("practitioners")), // Required: at least one practitioner
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    const allowedPractitionerIds = await resolvePractitionerIds(
      ctx.db,
      args.practitionerIds,
      args.practiceId,
      ruleSetId,
      true, // Required: at least one practitioner
    );

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
    const entityId = await ctx.db.insert("appointmentTypes", {
      allowedPractitionerIds,
      createdAt: BigInt(Date.now()),
      duration: args.duration,
      lastModified: BigInt(Date.now()),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
    });

    return { entityId, ruleSetId };
  },
  returns: createResultValidator,
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
    practitionerIds: v.optional(v.array(v.id("practitioners"))),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.appointmentTypeId);
    if (!entity) {
      throw new Error("Appointment type not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let appointmentType;
    if (entity.ruleSetId === ruleSetId) {
      appointmentType = entity;
    } else {
      appointmentType = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!appointmentType) {
        throw new Error(
          "Appointment type not found in unsaved rule set. This should not happen.",
        );
      }
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

    // Build updates object
    const updates: Partial<{
      allowedPractitionerIds: Id<"practitioners">[];
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
    if (args.practitionerIds !== undefined) {
      // Use the shared helper with required=true to validate at least one practitioner
      const resolved = await resolvePractitionerIds(
        ctx.db,
        args.practitionerIds,
        args.practiceId,
        ruleSetId,
        true, // Required: at least one practitioner
      );
      updates.allowedPractitionerIds = resolved;
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      appointmentType.ruleSetId,
      "appointment type",
    );

    await ctx.db.patch(appointmentType._id, updates);

    return { entityId: appointmentType._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Delete an appointment type from an unsaved rule set
 */
export const deleteAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    practiceId: v.id("practices"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.appointmentTypeId);
    if (!entity) {
      throw new Error("Appointment type not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let appointmentType;
    if (entity.ruleSetId === ruleSetId) {
      appointmentType = entity;
    } else {
      appointmentType = await ctx.db
        .query("appointmentTypes")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!appointmentType) {
        throw new Error(
          "Appointment type not found in unsaved rule set. This should not happen.",
        );
      }
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      appointmentType.ruleSetId,
      "appointment type",
    );

    await ctx.db.delete(appointmentType._id);

    return { entityId: appointmentType._id, ruleSetId };
  },
  returns: createResultValidator,
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
 * Create a new practitioner in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
 */
export const createPractitioner = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
    sourceRuleSetId: v.id("ruleSets"),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

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
    const entityId = await ctx.db.insert("practitioners", {
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
      ...(args.tags && { tags: args.tags }),
    });

    return { entityId, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Update a practitioner in an unsaved rule set
 */
export const updatePractitioner = mutation({
  args: {
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    sourceRuleSetId: v.id("ruleSets"),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.practitionerId);
    if (!entity) {
      throw new Error("Practitioner not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let practitioner;
    if (entity.ruleSetId === ruleSetId) {
      practitioner = entity;
    } else {
      practitioner = await ctx.db
        .query("practitioners")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!practitioner) {
        throw new Error(
          "Practitioner not found in unsaved rule set. This should not happen.",
        );
      }
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

    // Update the practitioner (use the entity in the unsaved rule set)
    const updates: Partial<{ name: string; tags: string[] | undefined }> = {};

    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.tags !== undefined) {
      updates.tags = args.tags;
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      practitioner.ruleSetId,
      "practitioner",
    );

    await ctx.db.patch(practitioner._id, updates);

    return { entityId: practitioner._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Delete a practitioner from an unsaved rule set
 */
export const deletePractitioner = mutation({
  args: {
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.practitionerId);
    if (!entity) {
      throw new Error("Practitioner not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let practitioner;
    if (entity.ruleSetId === ruleSetId) {
      practitioner = entity;
    } else {
      practitioner = await ctx.db
        .query("practitioners")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!practitioner) {
        throw new Error(
          "Practitioner not found in unsaved rule set. This should not happen.",
        );
      }
    }

    // Delete associated base schedules (using the practitioner ID from unsaved rule set)
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("practitionerId", practitioner._id),
      )
      .collect();

    // SAFETY: Verify all schedules belong to unsaved rule set before deleting
    for (const schedule of schedules) {
      await verifyEntityInUnsavedRuleSet(
        ctx.db,
        schedule.ruleSetId,
        "base schedule",
      );
      await ctx.db.delete(schedule._id);
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      practitioner.ruleSetId,
      "practitioner",
    );

    await ctx.db.delete(practitioner._id);

    return { entityId: practitioner._id, ruleSetId };
  },
  returns: createResultValidator,
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
 * Create a new location in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
 */
export const createLocation = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

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
    const entityId = await ctx.db.insert("locations", {
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
    });

    return { entityId, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Update a location in an unsaved rule set
 */
export const updateLocation = mutation({
  args: {
    locationId: v.id("locations"),
    name: v.string(),
    practiceId: v.id("practices"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.locationId);
    if (!entity) {
      throw new Error("Location not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let location;
    if (entity.ruleSetId === ruleSetId) {
      location = entity;
    } else {
      location = await ctx.db
        .query("locations")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!location) {
        throw new Error(
          "Location not found in unsaved rule set. This should not happen.",
        );
      }
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

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(ctx.db, location.ruleSetId, "location");

    // Update the location (use the entity in the unsaved rule set)
    await ctx.db.patch(location._id, { name: args.name });

    return { entityId: location._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Delete a location from an unsaved rule set
 */
export const deleteLocation = mutation({
  args: {
    locationId: v.id("locations"),
    practiceId: v.id("practices"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.locationId);
    if (!entity) {
      throw new Error("Location not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let location;
    if (entity.ruleSetId === ruleSetId) {
      location = entity;
    } else {
      location = await ctx.db
        .query("locations")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!location) {
        throw new Error(
          "Location not found in unsaved rule set. This should not happen.",
        );
      }
    }

    // Delete associated base schedules (using the location ID from unsaved rule set)
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_locationId", (q) => q.eq("locationId", location._id))
      .collect();

    // SAFETY: Verify all schedules belong to unsaved rule set before deleting
    for (const schedule of schedules) {
      await verifyEntityInUnsavedRuleSet(
        ctx.db,
        schedule.ruleSetId,
        "base schedule",
      );
      await ctx.db.delete(schedule._id);
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(ctx.db, location.ruleSetId, "location");

    await ctx.db.delete(location._id);

    return { entityId: location._id, ruleSetId };
  },
  returns: createResultValidator,
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
 * Create a new base schedule in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
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
    sourceRuleSetId: v.id("ruleSets"),
    startTime: v.string(),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get practitioner - might be from active/source rule set
    const practitionerEntity = await ctx.db.get(args.practitionerId);
    if (!practitionerEntity) {
      throw new Error("Practitioner not found");
    }

    // Find/use practitioner in unsaved rule set (CoW)
    let practitioner;
    if (practitionerEntity.ruleSetId === ruleSetId) {
      practitioner = practitionerEntity;
    } else {
      practitioner = await ctx.db
        .query("practitioners")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", practitionerEntity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!practitioner) {
        throw new Error(
          "Practitioner not found in unsaved rule set. This should not happen.",
        );
      }
    }

    // Get location - might be from active/source rule set
    const locationEntity = await ctx.db.get(args.locationId);
    if (!locationEntity) {
      throw new Error("Location not found");
    }

    // Find/use location in unsaved rule set (CoW)
    let location;
    if (locationEntity.ruleSetId === ruleSetId) {
      location = locationEntity;
    } else {
      location = await ctx.db
        .query("locations")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", locationEntity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!location) {
        throw new Error(
          "Location not found in unsaved rule set. This should not happen.",
        );
      }
    }

    // Create the base schedule with IDs from unsaved rule set
    const entityId = await ctx.db.insert("baseSchedules", {
      dayOfWeek: args.dayOfWeek,
      endTime: args.endTime,
      locationId: location._id, // Use ID from unsaved rule set
      practiceId: args.practiceId,
      practitionerId: practitioner._id, // Use ID from unsaved rule set
      ruleSetId,
      startTime: args.startTime,
      ...(args.breakTimes && { breakTimes: args.breakTimes }),
    });

    return { entityId, ruleSetId };
  },
  returns: createResultValidator,
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
    sourceRuleSetId: v.id("ruleSets"),
    startTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.baseScheduleId);
    if (!entity) {
      throw new Error("Base schedule not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let schedule;
    if (entity.ruleSetId === ruleSetId) {
      schedule = entity;
    } else {
      schedule = await ctx.db
        .query("baseSchedules")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!schedule) {
        throw new Error(
          "Base schedule not found in unsaved rule set. This should not happen.",
        );
      }
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

    // Update the schedule (use the entity in the unsaved rule set)
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

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      schedule.ruleSetId,
      "base schedule",
    );

    await ctx.db.patch(schedule._id, updates);

    return { entityId: schedule._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Delete a base schedule from an unsaved rule set
 */
export const deleteBaseSchedule = mutation({
  args: {
    baseScheduleId: v.id("baseSchedules"),
    practiceId: v.id("practices"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.baseScheduleId);
    if (!entity) {
      throw new Error("Base schedule not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let schedule;
    if (entity.ruleSetId === ruleSetId) {
      schedule = entity;
    } else {
      schedule = await ctx.db
        .query("baseSchedules")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!schedule) {
        throw new Error(
          "Base schedule not found in unsaved rule set. This should not happen.",
        );
      }
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      schedule.ruleSetId,
      "base schedule",
    );

    await ctx.db.delete(schedule._id);

    return { entityId: schedule._id, ruleSetId };
  },
  returns: createResultValidator,
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

// ================================
// RULES
// ================================

/**
 * Get all rules for a specific rule set
 */
export const getRules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("rules"),
      appliesTo: v.union(
        v.literal("ALL_PRACTITIONERS"),
        v.literal("SPECIFIC_PRACTITIONERS"),
      ),
      block_appointmentTypes: v.optional(v.array(v.string())),
      block_dateRangeEnd: v.optional(v.string()),
      block_dateRangeStart: v.optional(v.string()),
      block_daysOfWeek: v.optional(v.array(v.number())),
      block_exceptForPractitionerTags: v.optional(v.array(v.string())),
      block_timeRangeEnd: v.optional(v.string()),
      block_timeRangeStart: v.optional(v.string()),
      description: v.string(),
      limit_appointmentTypes: v.optional(v.array(v.string())),
      limit_atLocation: v.optional(v.id("locations")),
      limit_count: v.optional(v.number()),
      limit_perPractitioner: v.optional(v.boolean()),
      name: v.string(),
      practiceId: v.id("practices"),
      ruleSetId: v.id("ruleSets"),
      ruleType: v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),
      specificPractitioners: v.optional(v.array(v.id("practitioners"))),
    }),
  ),
});

/**
 * Create a new rule in a rule set
 */
export const createRule = mutation({
  args: {
    appliesTo: v.union(
      v.literal("ALL_PRACTITIONERS"),
      v.literal("SPECIFIC_PRACTITIONERS"),
    ),
    block_appointmentTypes: v.optional(v.array(v.string())),
    block_dateRangeEnd: v.optional(v.string()),
    block_dateRangeStart: v.optional(v.string()),
    block_daysOfWeek: v.optional(v.array(v.number())),
    block_exceptForPractitionerTags: v.optional(v.array(v.string())),
    block_timeRangeEnd: v.optional(v.string()),
    block_timeRangeStart: v.optional(v.string()),
    description: v.string(),
    limit_appointmentTypes: v.optional(v.array(v.string())),
    limit_atLocation: v.optional(v.id("locations")),
    limit_count: v.optional(v.number()),
    limit_perPractitioner: v.optional(v.boolean()),
    name: v.string(),
    practiceId: v.id("practices"),
    ruleType: v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),
    sourceRuleSetId: v.id("ruleSets"),
    specificPractitioners: v.optional(v.array(v.id("practitioners"))),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Check if rule name already exists in this rule set
    const existing = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .first();

    if (existing) {
      throw new Error(
        `Rule with name "${args.name}" already exists in this rule set`,
      );
    }

    const ruleData: {
      appliesTo: "ALL_PRACTITIONERS" | "SPECIFIC_PRACTITIONERS";
      block_appointmentTypes?: string[];
      block_dateRangeEnd?: string;
      block_dateRangeStart?: string;
      block_daysOfWeek?: number[];
      block_exceptForPractitionerTags?: string[];
      block_timeRangeEnd?: string;
      block_timeRangeStart?: string;
      description: string;
      limit_appointmentTypes?: string[];
      limit_atLocation?: Id<"locations">;
      limit_count?: number;
      limit_perPractitioner?: boolean;
      name: string;
      practiceId: Id<"practices">;
      ruleSetId: Id<"ruleSets">;
      ruleType: "BLOCK" | "LIMIT_CONCURRENT";
      specificPractitioners?: Id<"practitioners">[];
    } = {
      appliesTo: args.appliesTo,
      description: args.description,
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId,
      ruleType: args.ruleType,
    };

    if (args.specificPractitioners !== undefined) {
      ruleData.specificPractitioners = args.specificPractitioners;
    }
    if (args.block_appointmentTypes !== undefined) {
      ruleData.block_appointmentTypes = args.block_appointmentTypes;
    }
    if (args.block_dateRangeStart !== undefined) {
      ruleData.block_dateRangeStart = args.block_dateRangeStart;
    }
    if (args.block_dateRangeEnd !== undefined) {
      ruleData.block_dateRangeEnd = args.block_dateRangeEnd;
    }
    if (args.block_daysOfWeek !== undefined) {
      ruleData.block_daysOfWeek = args.block_daysOfWeek;
    }
    if (args.block_timeRangeStart !== undefined) {
      ruleData.block_timeRangeStart = args.block_timeRangeStart;
    }
    if (args.block_timeRangeEnd !== undefined) {
      ruleData.block_timeRangeEnd = args.block_timeRangeEnd;
    }
    if (args.block_exceptForPractitionerTags !== undefined) {
      ruleData.block_exceptForPractitionerTags =
        args.block_exceptForPractitionerTags;
    }
    if (args.limit_appointmentTypes !== undefined) {
      ruleData.limit_appointmentTypes = args.limit_appointmentTypes;
    }
    if (args.limit_count !== undefined) {
      ruleData.limit_count = args.limit_count;
    }
    if (args.limit_perPractitioner !== undefined) {
      ruleData.limit_perPractitioner = args.limit_perPractitioner;
    }
    if (args.limit_atLocation !== undefined) {
      ruleData.limit_atLocation = args.limit_atLocation;
    }

    const entityId = await ctx.db.insert("rules", ruleData);

    return { entityId, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Update an existing rule
 */
export const updateRule = mutation({
  args: {
    appliesTo: v.optional(
      v.union(
        v.literal("ALL_PRACTITIONERS"),
        v.literal("SPECIFIC_PRACTITIONERS"),
      ),
    ),
    block_appointmentTypes: v.optional(v.array(v.string())),
    block_dateRangeEnd: v.optional(v.string()),
    block_dateRangeStart: v.optional(v.string()),
    block_daysOfWeek: v.optional(v.array(v.number())),
    block_exceptForPractitionerTags: v.optional(v.array(v.string())),
    block_timeRangeEnd: v.optional(v.string()),
    block_timeRangeStart: v.optional(v.string()),
    description: v.optional(v.string()),
    limit_appointmentTypes: v.optional(v.array(v.string())),
    limit_atLocation: v.optional(v.id("locations")),
    limit_count: v.optional(v.number()),
    limit_perPractitioner: v.optional(v.boolean()),
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
    ruleId: v.id("rules"),
    ruleType: v.optional(
      v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),
    ),
    sourceRuleSetId: v.id("ruleSets"),
    specificPractitioners: v.optional(v.array(v.id("practitioners"))),
  },
  handler: async (ctx, args) => {
    // Get the original rule (might be from active rule set)
    const originalRule = await ctx.db.get(args.ruleId);
    if (!originalRule) {
      throw new Error("Rule not found");
    }

    if (originalRule.practiceId !== args.practiceId) {
      throw new Error("Rule does not belong to this practice");
    }

    // Ensure we have an unsaved rule set - this handles CoW automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let rule;
    if (originalRule.ruleSetId === ruleSetId) {
      rule = originalRule;
    } else {
      rule = await ctx.db
        .query("rules")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", originalRule._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!rule) {
        throw new Error(
          "Rule not found in unsaved rule set. This should not happen.",
        );
      }
    }

    // If name is changing, check for conflicts
    if (args.name && args.name !== rule.name) {
      // Safe to use non-null assertion: args.name is checked above
      const existing = await ctx.db
        .query("rules")
        .withIndex("by_ruleSetId_name", (q) =>
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          q.eq("ruleSetId", ruleSetId).eq("name", args.name!),
        )
        .first();

      if (existing && existing._id !== rule._id) {
        throw new Error(
          `Rule with name "${args.name}" already exists in this rule set`,
        );
      }
    }

    // Update the rule (use the entity in the unsaved rule set)
    const updates: Partial<typeof rule> = {};
    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.description !== undefined) {
      updates.description = args.description;
    }
    if (args.ruleType !== undefined) {
      updates.ruleType = args.ruleType;
    }
    if (args.appliesTo !== undefined) {
      updates.appliesTo = args.appliesTo;
    }
    if (args.specificPractitioners !== undefined) {
      updates.specificPractitioners = args.specificPractitioners;
    }
    if (args.block_appointmentTypes !== undefined) {
      updates.block_appointmentTypes = args.block_appointmentTypes;
    }
    if (args.block_dateRangeStart !== undefined) {
      updates.block_dateRangeStart = args.block_dateRangeStart;
    }
    if (args.block_dateRangeEnd !== undefined) {
      updates.block_dateRangeEnd = args.block_dateRangeEnd;
    }
    if (args.block_daysOfWeek !== undefined) {
      updates.block_daysOfWeek = args.block_daysOfWeek;
    }
    if (args.block_timeRangeStart !== undefined) {
      updates.block_timeRangeStart = args.block_timeRangeStart;
    }
    if (args.block_timeRangeEnd !== undefined) {
      updates.block_timeRangeEnd = args.block_timeRangeEnd;
    }
    if (args.block_exceptForPractitionerTags !== undefined) {
      updates.block_exceptForPractitionerTags =
        args.block_exceptForPractitionerTags;
    }
    if (args.limit_appointmentTypes !== undefined) {
      updates.limit_appointmentTypes = args.limit_appointmentTypes;
    }
    if (args.limit_count !== undefined) {
      updates.limit_count = args.limit_count;
    }
    if (args.limit_perPractitioner !== undefined) {
      updates.limit_perPractitioner = args.limit_perPractitioner;
    }
    if (args.limit_atLocation !== undefined) {
      updates.limit_atLocation = args.limit_atLocation;
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(ctx.db, rule.ruleSetId, "rule");

    await ctx.db.patch(rule._id, updates);

    return { entityId: rule._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Delete a rule
 */
export const deleteRule = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleId: v.id("rules"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get the original rule (might be from active rule set)
    const originalRule = await ctx.db.get(args.ruleId);
    if (!originalRule) {
      throw new Error("Rule not found");
    }

    if (originalRule.practiceId !== args.practiceId) {
      throw new Error("Rule does not belong to this practice");
    }

    // Ensure we're working with an unsaved rule set - this handles CoW automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let rule;
    if (originalRule.ruleSetId === ruleSetId) {
      rule = originalRule;
    } else {
      rule = await ctx.db
        .query("rules")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", originalRule._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!rule) {
        throw new Error(
          "Rule not found in unsaved rule set. This should not happen.",
        );
      }
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(ctx.db, rule.ruleSetId, "rule");

    await ctx.db.delete(rule._id);

    return { entityId: rule._id, ruleSetId };
  },
  returns: createResultValidator,
});

// ================================
// ACTIVE RULE SET QUERIES
// These are convenience queries that fetch from the active rule set using practiceId
// ================================

/**
 * Get practitioners from the active rule set
 */
export const getPractitionersFromActive = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const practice = await ctx.db.get(args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return [];
    }
    const ruleSetId = practice.currentActiveRuleSetId;
    return await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
  },
});

/**
 * Get locations from the active rule set
 */
export const getLocationsFromActive = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const practice = await ctx.db.get(args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return [];
    }
    const ruleSetId = practice.currentActiveRuleSetId;
    return await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
  },
});

/**
 * Get base schedules from the active rule set
 */
export const getBaseSchedulesFromActive = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const practice = await ctx.db.get(args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return [];
    }
    const ruleSetId = practice.currentActiveRuleSetId;
    return await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
  },
});
