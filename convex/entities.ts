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
 * - Rule Conditions (Rules)
 */

import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { v } from "convex/values";

import type { DataModel } from "./_generated/dataModel";
import type { Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import {
  type EntityType,
  getOrCreateUnsavedRuleSet,
  validateEntityIdsInRuleSet,
  verifyEntityInUnsavedRuleSet,
} from "./copyOnWrite";
import {
  type ConditionTreeNode,
  conditionTreeNodeValidator,
  getTypedChildren,
  isLogicalNode,
} from "./ruleEngine";

// Type aliases for cleaner code
type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

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
    v.id("ruleConditions"), // Changed from "rules" to "ruleConditions"
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
      if (practitioner?.ruleSetId !== ruleSetId) {
        throw new Error("Practitioner does not belong to the unsaved rule set");
      }
    }

    // Verify new location if provided
    if (args.locationId) {
      const location = await ctx.db.get(args.locationId);
      if (location?.ruleSetId !== ruleSetId) {
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
// RULE CONDITIONS (RULES)
// ================================

// conditionTreeNodeValidator and ConditionTreeNode are imported from ruleEngine.ts
// to avoid duplication and ensure consistency

/**
 * Recursively remap entity IDs in a condition tree from source rule set to target rule set.
 * This is needed when the UI passes entity IDs from a different rule set than the target.
 */
async function remapConditionTreeEntityIds(
  db: DatabaseReader,
  node: ConditionTreeNode,
  sourceRuleSetId: Id<"ruleSets">,
  targetRuleSetId: Id<"ruleSets">,
): Promise<ConditionTreeNode> {
  // If source and target are the same, no remapping needed
  if (sourceRuleSetId === targetRuleSetId) {
    return node;
  }

  if (node.nodeType === "CONDITION") {
    // Check if this condition type has entity references that need remapping
    if (node.valueIds && node.valueIds.length > 0) {
      // Handle CONCURRENT_COUNT and DAILY_CAPACITY
      // Their valueIds contains appointment type IDs (scope is now a separate field)
      if (
        node.conditionType === "CONCURRENT_COUNT" ||
        node.conditionType === "DAILY_CAPACITY"
      ) {
        // Remap the appointment type IDs
        const remappedIds: string[] = [];

        for (const oldId of node.valueIds) {
          const oldEntity = await db.get(oldId as Id<"appointmentTypes">);

          if (!oldEntity) {
            throw new Error(
              `AppointmentType ${oldId} not found when remapping from rule set ${sourceRuleSetId} to ${targetRuleSetId}`,
            );
          }

          // Find the corresponding entity in the target rule set by name
          const newEntity = await db
            .query("appointmentTypes")
            .withIndex("by_ruleSetId", (q) =>
              q.eq("ruleSetId", targetRuleSetId),
            )
            .filter((q) => q.eq(q.field("name"), oldEntity.name))
            .first();

          if (!newEntity) {
            throw new Error(
              `Could not find appointmentType with name "${oldEntity.name}" in target rule set ${targetRuleSetId}. ` +
                `This may indicate the entity was not copied during copy-on-write.`,
            );
          }

          remappedIds.push(newEntity._id);
        }

        return {
          ...node,
          valueIds: remappedIds,
        };
      }

      // Handle standard conditions (PRACTITIONER, LOCATION, APPOINTMENT_TYPE)
      if (
        node.conditionType === "PRACTITIONER" ||
        node.conditionType === "LOCATION" ||
        node.conditionType === "APPOINTMENT_TYPE"
      ) {
        const tableName =
          node.conditionType === "PRACTITIONER"
            ? "practitioners"
            : node.conditionType === "LOCATION"
              ? "locations"
              : "appointmentTypes";

        // Remap each entity ID
        const remappedIds: string[] = [];
        for (const oldId of node.valueIds) {
          // Get the old entity
          const oldEntity = await db.get(
            oldId as
              | Id<"appointmentTypes">
              | Id<"locations">
              | Id<"practitioners">,
          );

          if (!oldEntity) {
            throw new Error(
              `Entity ${oldId} not found when remapping from rule set ${sourceRuleSetId} to ${targetRuleSetId}`,
            );
          }

          // Find the corresponding entity in the target rule set by name
          // (entities are copied with the same name)
          const newEntity = await db
            .query(tableName)
            .withIndex("by_ruleSetId", (q) =>
              q.eq("ruleSetId", targetRuleSetId),
            )
            .filter((q) => q.eq(q.field("name"), oldEntity.name))
            .first();

          if (!newEntity) {
            throw new Error(
              `Could not find ${tableName} with name "${oldEntity.name}" in target rule set ${targetRuleSetId}. ` +
                `This may indicate the entity was not copied during copy-on-write.`,
            );
          }

          remappedIds.push(newEntity._id);
        }

        return {
          ...node,
          valueIds: remappedIds,
        };
      }
    }

    // No remapping needed for this condition
    return node;
  }

  // Recursively remap children for AND/NOT nodes
  if (isLogicalNode(node)) {
    const typedChildren = getTypedChildren(node);
    const remappedChildren: ConditionTreeNode[] = [];
    for (const child of typedChildren) {
      const remappedChild = await remapConditionTreeEntityIds(
        db,
        child,
        sourceRuleSetId,
        targetRuleSetId,
      );
      remappedChildren.push(remappedChild);
    }

    return {
      ...node,
      children: remappedChildren,
    };
  }

  return node;
}

/**
 * Recursively insert a condition tree node and its children.
 * Returns the ID of the created node.
 */
async function insertConditionTreeNode(
  db: DatabaseWriter,
  node: ConditionTreeNode,
  parentConditionId: Id<"ruleConditions"> | null,
  childOrder: number,
  ruleSetId: Id<"ruleSets">,
  practiceId: Id<"practices">,
): Promise<Id<"ruleConditions">> {
  const now = BigInt(Date.now());

  if (node.nodeType === "CONDITION") {
    // Validate that any referenced entity IDs belong to the correct rule set
    if (node.valueIds && node.valueIds.length > 0) {
      switch (node.conditionType) {
        case "APPOINTMENT_TYPE": {
          await validateEntityIdsInRuleSet(
            db,
            node.valueIds,
            ruleSetId,
            "appointmentTypes",
          );

          break;
        }
        case "CONCURRENT_COUNT":
        case "DAILY_CAPACITY": {
          // For CONCURRENT_COUNT and DAILY_CAPACITY, valueIds contains appointment type IDs
          // (scope is now a separate field)
          if (node.valueIds.length > 0) {
            await validateEntityIdsInRuleSet(
              db,
              node.valueIds,
              ruleSetId,
              "appointmentTypes",
            );
          }

          break;
        }
        case "LOCATION": {
          await validateEntityIdsInRuleSet(
            db,
            node.valueIds,
            ruleSetId,
            "locations",
          );

          break;
        }
        case "PRACTITIONER": {
          await validateEntityIdsInRuleSet(
            db,
            node.valueIds,
            ruleSetId,
            "practitioners",
          );

          break;
        }
        // No default
      }
    }

    // Leaf node
    const nodeId = await db.insert("ruleConditions", {
      childOrder,
      conditionType: node.conditionType,
      createdAt: now,
      isRoot: false,
      lastModified: now,
      nodeType: "CONDITION",
      operator: node.operator,
      ...(parentConditionId && { parentConditionId }),
      practiceId,
      ruleSetId,
      ...(node.scope && { scope: node.scope }),
      ...(node.valueIds && { valueIds: node.valueIds }),
      ...(node.valueNumber !== undefined && { valueNumber: node.valueNumber }),
    });
    return nodeId;
  } else {
    // Logical operator node (AND/NOT)
    const nodeId = await db.insert("ruleConditions", {
      childOrder,
      createdAt: now,
      isRoot: false,
      lastModified: now,
      nodeType: node.nodeType,
      ...(parentConditionId && { parentConditionId }),
      practiceId,
      ruleSetId,
    });

    // Recursively insert children (getTypedChildren validates all children exist)
    const typedChildren = getTypedChildren(node);
    for (const [i, child] of typedChildren.entries()) {
      await insertConditionTreeNode(
        db,
        child,
        nodeId,
        i,
        ruleSetId,
        practiceId,
      );
    }

    return nodeId;
  }
}

/**
 * Create a new rule with its condition tree in an unsaved rule set.
 * Returns both the created rule ID and the rule set ID.
 */
export const createRule = mutation({
  args: {
    conditionTree: conditionTreeNodeValidator,
    enabled: v.optional(v.boolean()),
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

    // Remap entity IDs in the condition tree if the source and target rule sets differ
    // This handles the case where the UI passes entity IDs from the source rule set
    // but we need to use entity IDs from the target (unsaved) rule set
    const remappedConditionTree = await remapConditionTreeEntityIds(
      ctx.db,
      args.conditionTree,
      args.sourceRuleSetId,
      ruleSetId,
    );

    const now = BigInt(Date.now());

    // Create the root node (the rule itself)
    const rootId = await ctx.db.insert("ruleConditions", {
      childOrder: 0, // Root nodes don't have siblings, but we set this for consistency
      createdAt: now,
      enabled: args.enabled ?? true,
      isRoot: true,
      lastModified: now,
      practiceId: args.practiceId,
      ruleSetId,
    });

    // Insert the condition tree as the first (and only) child of the root
    await insertConditionTreeNode(
      ctx.db,
      remappedConditionTree,
      rootId,
      0,
      ruleSetId,
      args.practiceId,
    );

    return { entityId: rootId, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Recursively delete a condition node and all its children.
 */
async function deleteConditionTreeNode(
  db: DatabaseWriter,
  nodeId: Id<"ruleConditions">,
): Promise<void> {
  // Get all children
  const children = await db
    .query("ruleConditions")
    .withIndex("by_parentConditionId", (q) => q.eq("parentConditionId", nodeId))
    .collect();

  // Recursively delete children first
  for (const child of children) {
    await deleteConditionTreeNode(db, child._id);
  }

  // Delete this node
  await db.delete(nodeId);
}

/**
 * Delete a rule and its entire condition tree from an unsaved rule set.
 */
export const deleteRule = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleId: v.id("ruleConditions"),
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
    const entity = await ctx.db.get(args.ruleId);
    if (!entity) {
      throw new Error("Rule not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by copyFromId
    let rule;
    if (entity.ruleSetId === ruleSetId) {
      rule = entity;
    } else {
      // Find the copy in the unsaved rule set
      const copy = await ctx.db
        .query("ruleConditions")
        .withIndex("by_copyFromId_ruleSetId", (q) =>
          q.eq("copyFromId", args.ruleId).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!copy) {
        throw new Error(
          "Rule copy not found in unsaved rule set. This should not happen.",
        );
      }
      rule = copy;
    }

    // Verify it's a root node
    if (!rule.isRoot) {
      throw new Error("Can only delete root rule nodes, not condition nodes");
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      rule.ruleSetId,
      "rule" as EntityType,
    );

    // Recursively delete the entire tree
    await deleteConditionTreeNode(ctx.db, rule._id);

    return { entityId: rule._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Update a rule's metadata (enabled status) in an unsaved rule set.
 * Does NOT support updating the condition tree - use deleteRule + createRule for that.
 */
export const updateRule = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    practiceId: v.id("practices"),
    ruleId: v.id("ruleConditions"),
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
    const entity = await ctx.db.get(args.ruleId);
    if (!entity) {
      throw new Error("Rule not found");
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by copyFromId
    let rule;
    if (entity.ruleSetId === ruleSetId) {
      rule = entity;
    } else {
      // Find the copy in the unsaved rule set
      const copy = await ctx.db
        .query("ruleConditions")
        .withIndex("by_copyFromId_ruleSetId", (q) =>
          q.eq("copyFromId", args.ruleId).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!copy) {
        throw new Error(
          "Rule copy not found in unsaved rule set. This should not happen.",
        );
      }
      rule = copy;
    }

    // Verify it's a root node
    if (!rule.isRoot) {
      throw new Error("Can only update root rule nodes, not condition nodes");
    }

    // Build updates object
    const updates: Partial<{
      enabled: boolean;
      lastModified: bigint;
    }> = {
      lastModified: BigInt(Date.now()),
    };

    if (args.enabled !== undefined) {
      updates.enabled = args.enabled;
    }

    // SAFETY: Verify entity belongs to unsaved rule set before patching
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      rule.ruleSetId,
      "rule" as EntityType,
    );

    await ctx.db.patch(rule._id, updates);

    return { entityId: rule._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Recursively fetch a condition tree node and its children.
 */
async function fetchConditionTreeNode(
  db: DatabaseReader,
  nodeId: Id<"ruleConditions">,
): Promise<ConditionTreeNode> {
  const node = await db.get(nodeId);
  if (!node) {
    throw new Error("Condition node not found");
  }

  if (node.nodeType === "CONDITION") {
    if (!node.conditionType || !node.operator) {
      throw new Error(
        "Condition node missing conditionType or operator. Data corruption?",
      );
    }
    return {
      conditionType: node.conditionType,
      nodeType: "CONDITION",
      operator: node.operator,
      ...(node.valueIds && { valueIds: node.valueIds }),
      ...(node.valueNumber !== undefined && { valueNumber: node.valueNumber }),
    };
  } else {
    // Logical operator node - fetch children
    if (!node.nodeType) {
      throw new Error("Logical node missing nodeType. Data corruption?");
    }
    const children = await db
      .query("ruleConditions")
      .withIndex("by_parentConditionId_childOrder", (q) =>
        q.eq("parentConditionId", nodeId),
      )
      .collect();

    const childNodes = await Promise.all(
      children.map((child) => fetchConditionTreeNode(db, child._id)),
    );

    return {
      children: childNodes,
      nodeType: node.nodeType,
    };
  }
}

/**
 * Get all rules for a rule set with their denormalized condition trees.
 */
export const getRules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get all root nodes (rules)
    const roots = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId_isRoot", (q) =>
        q.eq("ruleSetId", args.ruleSetId).eq("isRoot", true),
      )
      .collect();

    // Fetch the condition tree for each rule
    const rules = await Promise.all(
      roots.map(async (root) => {
        // Get the first (and only) child which is the root of the condition tree
        const conditionTreeRoot = await ctx.db
          .query("ruleConditions")
          .withIndex("by_parentConditionId_childOrder", (q) =>
            q.eq("parentConditionId", root._id),
          )
          .first();

        if (!conditionTreeRoot) {
          throw new Error(
            `Rule ${root._id} has no condition tree. This should not happen.`,
          );
        }

        const conditionTree = await fetchConditionTreeNode(
          ctx.db,
          conditionTreeRoot._id,
        );

        return {
          _id: root._id,
          conditionTree,
          copyFromId: root.copyFromId,
          createdAt: root.createdAt,
          enabled: root.enabled ?? true,
          lastModified: root.lastModified,
          practiceId: root.practiceId,
          ruleSetId: root.ruleSetId,
        };
      }),
    );

    return rules;
  },
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

/**
 * Get appointment types from the active rule set
 */
export const getAppointmentTypesFromActive = query({
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
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
  },
});
