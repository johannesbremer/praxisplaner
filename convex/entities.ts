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
  validateAppointmentTypeIdsInRuleSet,
  validateLocationIdsInRuleSet,
  validatePractitionerIdsInRuleSet,
  verifyEntityInUnsavedRuleSet,
} from "./copyOnWrite";
import {
  ensurePracticeAccessForMutation,
  ensurePracticeAccessForQuery,
  ensureRuleSetAccessForQuery,
} from "./practiceAccess";
import {
  type ConditionTreeNode,
  conditionTreeNodeValidator,
  getTypedChildren,
  isLogicalNode,
} from "./ruleEngine";
import { ensureAuthenticatedIdentity } from "./userIdentity";

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

const baseSchedulePayloadValidator = v.object({
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
  practitionerId: v.id("practitioners"),
  startTime: v.string(),
});

const replaceBaseScheduleSetResultValidator = v.object({
  createdScheduleIds: v.array(v.id("baseSchedules")),
  deletedScheduleIds: v.array(v.id("baseSchedules")),
  ruleSetId: v.id("ruleSets"),
});

const practitionerBaseScheduleSnapshotValidator = v.object({
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
  startTime: v.string(),
});

const practitionerSnapshotValidator = v.object({
  id: v.id("practitioners"),
  name: v.string(),
  tags: v.optional(v.array(v.string())),
});

const practitionerAppointmentTypePatchValidator = v.object({
  action: v.union(v.literal("delete"), v.literal("patch")),
  afterAllowedPractitionerIds: v.array(v.id("practitioners")),
  appointmentTypeId: v.id("appointmentTypes"),
  beforeAllowedPractitionerIds: v.array(v.id("practitioners")),
  duration: v.optional(v.number()),
  name: v.optional(v.string()),
});

const practitionerConditionPatchValidator = v.object({
  afterValueIds: v.array(v.string()),
  beforeValueIds: v.array(v.string()),
  conditionId: v.id("ruleConditions"),
});

const practitionerDependencySnapshotValidator = v.object({
  appointmentTypePatches: v.array(practitionerAppointmentTypePatchValidator),
  baseSchedules: v.array(practitionerBaseScheduleSnapshotValidator),
  practitioner: practitionerSnapshotValidator,
  practitionerConditionPatches: v.array(practitionerConditionPatchValidator),
});

const deletePractitionerWithDependenciesResultValidator = v.object({
  ruleSetId: v.id("ruleSets"),
  snapshot: practitionerDependencySnapshotValidator,
});

const restorePractitionerWithDependenciesResultValidator = v.object({
  restoredPractitionerId: v.id("practitioners"),
  ruleSetId: v.id("ruleSets"),
});

// ================================
// SHARED HELPER FUNCTIONS
// ================================

/**
 * Resolve a base schedule ID into the current unsaved rule set.
 * Returns null when neither the original nor a CoW copy exists.
 */
async function resolveBaseScheduleIdInRuleSet(
  db: DatabaseReader,
  baseScheduleId: Id<"baseSchedules">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"baseSchedules"> | null> {
  const scheduleEntity = await db.get("baseSchedules", baseScheduleId);
  if (!scheduleEntity) {
    return null;
  }

  if (scheduleEntity.ruleSetId === ruleSetId) {
    return scheduleEntity._id;
  }

  const scheduleCopy = await db
    .query("baseSchedules")
    .withIndex("by_parentId_ruleSetId", (q) =>
      q.eq("parentId", scheduleEntity._id).eq("ruleSetId", ruleSetId),
    )
    .first();

  return scheduleCopy?._id ?? null;
}

/**
 * Resolve a location ID into the current unsaved rule set.
 */
async function resolveLocationIdInRuleSet(
  db: DatabaseReader,
  locationId: Id<"locations">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"locations">> {
  const locationEntity = await db.get("locations", locationId);
  if (!locationEntity) {
    throw new Error("Location not found");
  }
  if (locationEntity.practiceId !== practiceId) {
    throw new Error("Location does not belong to this practice");
  }

  if (locationEntity.ruleSetId === ruleSetId) {
    return locationEntity._id;
  }

  const locationCopy = await db
    .query("locations")
    .withIndex("by_parentId_ruleSetId", (q) =>
      q.eq("parentId", locationEntity._id).eq("ruleSetId", ruleSetId),
    )
    .first();

  if (!locationCopy) {
    throw new Error(
      "Location not found in unsaved rule set. This should not happen.",
    );
  }

  return locationCopy._id;
}

/**
 * Resolve a practitioner ID into the current unsaved rule set.
 */
async function resolvePractitionerIdInRuleSet(
  db: DatabaseReader,
  practitionerId: Id<"practitioners">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
): Promise<Id<"practitioners">> {
  const practitionerEntity = await db.get("practitioners", practitionerId);
  if (!practitionerEntity) {
    throw new Error("Practitioner not found");
  }
  if (practitionerEntity.practiceId !== practiceId) {
    throw new Error("Practitioner does not belong to this practice");
  }

  if (practitionerEntity.ruleSetId === ruleSetId) {
    return practitionerEntity._id;
  }

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

  return practitionerCopy._id;
}

/**
 * Resolve practitioner entity in the target unsaved rule set.
 */
async function resolvePractitionerEntityInRuleSet(
  db: DatabaseReader,
  practitionerId: Id<"practitioners">,
  practiceId: Id<"practices">,
  ruleSetId: Id<"ruleSets">,
) {
  const practitionerEntity = await db.get("practitioners", practitionerId);
  if (!practitionerEntity) {
    throw new Error("Practitioner not found");
  }
  if (practitionerEntity.practiceId !== practiceId) {
    throw new Error("Practitioner does not belong to this practice");
  }

  if (practitionerEntity.ruleSetId === ruleSetId) {
    return practitionerEntity;
  }

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

  return practitionerCopy;
}

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
    const practitionerEntity = await db.get("practitioners", practitionerId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("appointmentTypes", args.appointmentTypeId);
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

    await ctx.db.patch("appointmentTypes", appointmentType._id, updates);

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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("appointmentTypes", args.appointmentTypeId);
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

    await ctx.db.delete("appointmentTypes", appointmentType._id);

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
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    const practitioner = await resolvePractitionerEntityInRuleSet(
      ctx.db,
      args.practitionerId,
      args.practiceId,
      ruleSetId,
    );

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

    await ctx.db.patch("practitioners", practitioner._id, updates);

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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("practitioners", args.practitionerId);
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
      await ctx.db.delete("baseSchedules", schedule._id);
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(
      ctx.db,
      practitioner.ruleSetId,
      "practitioner",
    );

    await ctx.db.delete("practitioners", practitioner._id);

    return { entityId: practitioner._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Delete a practitioner and dependent references atomically.
 *
 * This mutation snapshots and updates all practitioner references so undo can
 * restore the previous state safely in a single transaction.
 */
export const deletePractitionerWithDependencies = mutation({
  args: {
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    const practitioner = await resolvePractitionerEntityInRuleSet(
      ctx.db,
      args.practitionerId,
      args.practiceId,
      ruleSetId,
    );

    const practitionerIdAsString = practitioner._id as string;
    const now = BigInt(Date.now());

    const baseSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId_practitionerId", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("practitionerId", practitioner._id),
      )
      .collect();

    const baseScheduleSnapshots = baseSchedules.map((schedule) => ({
      ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
      dayOfWeek: schedule.dayOfWeek,
      endTime: schedule.endTime,
      locationId: schedule.locationId,
      startTime: schedule.startTime,
    }));

    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();

    const appointmentTypePatches: {
      action: "delete" | "patch";
      afterAllowedPractitionerIds: Id<"practitioners">[];
      appointmentTypeId: Id<"appointmentTypes">;
      beforeAllowedPractitionerIds: Id<"practitioners">[];
      duration?: number;
      name?: string;
    }[] = appointmentTypes
      .filter((appointmentType) =>
        appointmentType.allowedPractitionerIds.includes(practitioner._id),
      )
      .map((appointmentType) => {
        const afterAllowedPractitionerIds =
          appointmentType.allowedPractitionerIds.filter(
            (id) => id !== practitioner._id,
          );
        const action: "delete" | "patch" = "patch";

        return {
          action,
          afterAllowedPractitionerIds,
          appointmentTypeId: appointmentType._id,
          beforeAllowedPractitionerIds: appointmentType.allowedPractitionerIds,
        };
      });

    for (const patch of appointmentTypePatches) {
      const appointmentType = await ctx.db.get(
        "appointmentTypes",
        patch.appointmentTypeId,
      );
      if (appointmentType?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Die Terminart wurde zwischenzeitlich geändert und kann nicht konsistent aktualisiert werden.",
        );
      }

      await ctx.db.patch("appointmentTypes", appointmentType._id, {
        allowedPractitionerIds: patch.afterAllowedPractitionerIds,
        lastModified: now,
      });
    }

    const ruleConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();

    const practitionerConditionPatches = ruleConditions.flatMap((condition) => {
      if (
        condition.nodeType !== "CONDITION" ||
        condition.conditionType !== "PRACTITIONER"
      ) {
        return [];
      }

      const beforeValueIds = condition.valueIds ?? [];
      if (!beforeValueIds.includes(practitionerIdAsString)) {
        return [];
      }

      const afterValueIds = beforeValueIds.filter(
        (valueId) => valueId !== practitionerIdAsString,
      );

      return [
        {
          afterValueIds,
          beforeValueIds,
          conditionId: condition._id,
        },
      ];
    });

    for (const patch of practitionerConditionPatches) {
      const condition = await ctx.db.get("ruleConditions", patch.conditionId);
      if (condition?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Regelbedingungen wurden zwischenzeitlich geändert und können nicht konsistent aktualisiert werden.",
        );
      }

      await ctx.db.patch("ruleConditions", condition._id, {
        lastModified: now,
        valueIds: patch.afterValueIds,
      });
    }

    for (const schedule of baseSchedules) {
      await ctx.db.delete("baseSchedules", schedule._id);
    }

    await ctx.db.delete("practitioners", practitioner._id);

    return {
      ruleSetId,
      snapshot: {
        appointmentTypePatches,
        baseSchedules: baseScheduleSnapshots,
        practitioner: {
          id: practitioner._id,
          name: practitioner.name,
          ...(practitioner.tags && { tags: practitioner.tags }),
        },
        practitionerConditionPatches,
      },
    };
  },
  returns: deletePractitionerWithDependenciesResultValidator,
});

/**
 * Restore a previously deleted practitioner and dependent references atomically.
 */
export const restorePractitionerWithDependencies = mutation({
  args: {
    practiceId: v.id("practices"),
    snapshot: practitionerDependencySnapshotValidator,
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );
    const now = BigInt(Date.now());
    const previousPractitionerId = args.snapshot.practitioner.id;
    const previousPractitionerIdAsString = previousPractitionerId as string;

    const duplicateName = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId_name", (q) =>
        q
          .eq("ruleSetId", ruleSetId)
          .eq("name", args.snapshot.practitioner.name),
      )
      .first();
    if (duplicateName) {
      throw new Error(
        `Der Arzt "${args.snapshot.practitioner.name}" kann nicht wiederhergestellt werden, weil bereits ein Arzt mit diesem Namen existiert.`,
      );
    }

    const restoredPractitionerId = await ctx.db.insert("practitioners", {
      name: args.snapshot.practitioner.name,
      practiceId: args.practiceId,
      ruleSetId,
      ...(args.snapshot.practitioner.tags && {
        tags: args.snapshot.practitioner.tags,
      }),
    });

    for (const schedule of args.snapshot.baseSchedules) {
      const resolvedLocationId = await resolveLocationIdInRuleSet(
        ctx.db,
        schedule.locationId,
        args.practiceId,
        ruleSetId,
      );

      await ctx.db.insert("baseSchedules", {
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        locationId: resolvedLocationId,
        practiceId: args.practiceId,
        practitionerId: restoredPractitionerId,
        ruleSetId,
        startTime: schedule.startTime,
      });
    }

    for (const patch of args.snapshot.appointmentTypePatches) {
      const restoredAllowedPractitionerIds =
        patch.beforeAllowedPractitionerIds.map((practitionerId) =>
          practitionerId === previousPractitionerId
            ? restoredPractitionerId
            : practitionerId,
        );

      if (restoredAllowedPractitionerIds.length === 0) {
        throw new Error(
          "Eine Terminart kann nicht ohne Behandler wiederhergestellt werden.",
        );
      }

      for (const practitionerId of restoredAllowedPractitionerIds) {
        if (practitionerId === restoredPractitionerId) {
          continue;
        }

        const practitionerDoc = await ctx.db.get(
          "practitioners",
          practitionerId,
        );
        if (
          practitionerDoc?.practiceId !== args.practiceId ||
          practitionerDoc.ruleSetId !== ruleSetId
        ) {
          throw new Error(
            "Die Terminart kann nicht vollständig wiederhergestellt werden, weil ein referenzierter Behandler fehlt.",
          );
        }
      }

      if (patch.action === "delete") {
        const patchName = patch.name;
        if (!patchName) {
          throw new Error(
            "Gelöschte Terminart konnte nicht wiederhergestellt werden (fehlender Name).",
          );
        }
        const patchDuration = patch.duration;
        if (patchDuration === undefined) {
          throw new Error(
            "Gelöschte Terminart konnte nicht wiederhergestellt werden (fehlende Dauer).",
          );
        }

        const existingByName = await ctx.db
          .query("appointmentTypes")
          .withIndex("by_ruleSetId_name", (q) =>
            q.eq("ruleSetId", ruleSetId).eq("name", patchName),
          )
          .first();
        if (existingByName) {
          throw new Error(
            `Die Terminart "${patchName}" kann nicht wiederhergestellt werden, weil bereits eine Terminart mit diesem Namen existiert.`,
          );
        }

        await ctx.db.insert("appointmentTypes", {
          allowedPractitionerIds: restoredAllowedPractitionerIds,
          createdAt: now,
          duration: patchDuration,
          lastModified: now,
          name: patchName,
          practiceId: args.practiceId,
          ruleSetId,
        });
        continue;
      }

      const appointmentType = await ctx.db.get(
        "appointmentTypes",
        patch.appointmentTypeId,
      );
      if (appointmentType?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Eine Terminart wurde zwischenzeitlich geändert und kann nicht wiederhergestellt werden.",
        );
      }

      await ctx.db.patch("appointmentTypes", appointmentType._id, {
        allowedPractitionerIds: restoredAllowedPractitionerIds,
        lastModified: now,
      });
    }

    for (const patch of args.snapshot.practitionerConditionPatches) {
      const condition = await ctx.db.get("ruleConditions", patch.conditionId);
      if (condition?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Regelbedingungen wurden zwischenzeitlich geändert und können nicht wiederhergestellt werden.",
        );
      }

      const restoredValueIds = patch.beforeValueIds.map((valueId) =>
        valueId === previousPractitionerIdAsString
          ? (restoredPractitionerId as string)
          : valueId,
      );

      await ctx.db.patch("ruleConditions", condition._id, {
        lastModified: now,
        valueIds: restoredValueIds,
      });
    }

    return {
      restoredPractitionerId,
      ruleSetId,
    };
  },
  returns: restorePractitionerWithDependenciesResultValidator,
});

/**
 * Get all practitioners for a rule set
 */
export const getPractitioners = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("locations", args.locationId);
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
    await ctx.db.patch("locations", location._id, { name: args.name });

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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("locations", args.locationId);
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
      await ctx.db.delete("baseSchedules", schedule._id);
    }

    // SAFETY: Verify entity belongs to unsaved rule set before deleting
    await verifyEntityInUnsavedRuleSet(ctx.db, location.ruleSetId, "location");

    await ctx.db.delete("locations", location._id);

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
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get practitioner - might be from active/source rule set
    const practitionerEntity = await ctx.db.get(
      "practitioners",
      args.practitionerId,
    );
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
    const locationEntity = await ctx.db.get("locations", args.locationId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("baseSchedules", args.baseScheduleId);
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
      const practitioner = await ctx.db.get(
        "practitioners",
        args.practitionerId,
      );
      if (practitioner?.ruleSetId !== ruleSetId) {
        throw new Error("Practitioner does not belong to the unsaved rule set");
      }
    }

    // Verify new location if provided
    if (args.locationId) {
      const location = await ctx.db.get("locations", args.locationId);
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

    await ctx.db.patch("baseSchedules", schedule._id, updates);

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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("baseSchedules", args.baseScheduleId);
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

    await ctx.db.delete("baseSchedules", schedule._id);

    return { entityId: schedule._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Replace a set of base schedules atomically in the unsaved rule set.
 *
 * This is used by undo/redo flows to swap one schedule set with another
 * in a single mutation, reducing partial-state windows.
 */
export const replaceBaseScheduleSet = mutation({
  args: {
    expectedAbsentIds: v.optional(v.array(v.id("baseSchedules"))),
    expectedPresentIds: v.array(v.id("baseSchedules")),
    practiceId: v.id("practices"),
    replacementSchedules: v.array(baseSchedulePayloadValidator),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    if (args.expectedPresentIds.length === 0) {
      throw new Error(
        "Keine Arbeitszeiten ausgewählt. Die Änderung kann nicht angewendet werden.",
      );
    }

    const resolvedExpectedPresentIds = await Promise.all(
      args.expectedPresentIds.map((id) =>
        resolveBaseScheduleIdInRuleSet(ctx.db, id, ruleSetId),
      ),
    );
    const expectedPresentIds = [
      ...new Set(
        resolvedExpectedPresentIds.filter(
          (id): id is Id<"baseSchedules"> => id !== null,
        ),
      ),
    ];

    if (expectedPresentIds.length !== args.expectedPresentIds.length) {
      throw new Error(
        "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher ersetzt werden.",
      );
    }

    const resolvedExpectedAbsentIds = await Promise.all(
      (args.expectedAbsentIds ?? []).map((id) =>
        resolveBaseScheduleIdInRuleSet(ctx.db, id, ruleSetId),
      ),
    );
    const expectedAbsentIds = [
      ...new Set(
        resolvedExpectedAbsentIds.filter(
          (id): id is Id<"baseSchedules"> => id !== null,
        ),
      ),
    ];

    const expectedPresentSet = new Set(expectedPresentIds);
    if (expectedAbsentIds.some((id) => expectedPresentSet.has(id))) {
      throw new Error(
        "Die Änderung kann nicht angewendet werden, weil alte und neue Arbeitszeiten gleichzeitig vorhanden sind.",
      );
    }

    for (const absentId of expectedAbsentIds) {
      const existing = await ctx.db.get("baseSchedules", absentId);
      if (existing?.ruleSetId === ruleSetId) {
        throw new Error(
          "Die Änderung kann nicht angewendet werden, weil alte und neue Arbeitszeiten gleichzeitig vorhanden sind.",
        );
      }
    }

    for (const presentId of expectedPresentIds) {
      const existing = await ctx.db.get("baseSchedules", presentId);
      if (existing?.ruleSetId !== ruleSetId) {
        throw new Error(
          "Die Arbeitszeiten haben sich zwischenzeitlich geändert und können nicht sicher ersetzt werden.",
        );
      }
    }

    for (const scheduleId of expectedPresentIds) {
      await verifyEntityInUnsavedRuleSet(ctx.db, ruleSetId, "base schedule");
      await ctx.db.delete("baseSchedules", scheduleId);
    }

    const createdScheduleIds: Id<"baseSchedules">[] = [];
    for (const schedule of args.replacementSchedules) {
      const practitionerId = await resolvePractitionerIdInRuleSet(
        ctx.db,
        schedule.practitionerId,
        args.practiceId,
        ruleSetId,
      );
      const locationId = await resolveLocationIdInRuleSet(
        ctx.db,
        schedule.locationId,
        args.practiceId,
        ruleSetId,
      );

      const createdId = await ctx.db.insert("baseSchedules", {
        dayOfWeek: schedule.dayOfWeek,
        endTime: schedule.endTime,
        locationId,
        practiceId: args.practiceId,
        practitionerId,
        ruleSetId,
        startTime: schedule.startTime,
        ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
      });
      createdScheduleIds.push(createdId);
    }

    return {
      createdScheduleIds,
      deletedScheduleIds: expectedPresentIds,
      ruleSetId,
    };
  },
  returns: replaceBaseScheduleSetResultValidator,
});

/**
 * Get all base schedules for a rule set
 */
export const getBaseSchedules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
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
          const oldEntity = await db.get(
            "appointmentTypes",
            oldId as Id<"appointmentTypes">,
          );

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
      if (node.conditionType === "PRACTITIONER") {
        const remappedIds: string[] = [];
        for (const oldId of node.valueIds) {
          const oldEntity = await db.get(
            "practitioners",
            oldId as Id<"practitioners">,
          );

          if (!oldEntity) {
            throw new Error(
              `Practitioner ${oldId} not found when remapping from rule set ${sourceRuleSetId} to ${targetRuleSetId}`,
            );
          }

          const newEntity = await db
            .query("practitioners")
            .withIndex("by_ruleSetId", (q) =>
              q.eq("ruleSetId", targetRuleSetId),
            )
            .filter((q) => q.eq(q.field("name"), oldEntity.name))
            .first();

          if (!newEntity) {
            throw new Error(
              `Could not find practitioner with name "${oldEntity.name}" in target rule set ${targetRuleSetId}. ` +
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

      if (node.conditionType === "LOCATION") {
        const remappedIds: string[] = [];
        for (const oldId of node.valueIds) {
          const oldEntity = await db.get("locations", oldId as Id<"locations">);

          if (!oldEntity) {
            throw new Error(
              `Location ${oldId} not found when remapping from rule set ${sourceRuleSetId} to ${targetRuleSetId}`,
            );
          }

          const newEntity = await db
            .query("locations")
            .withIndex("by_ruleSetId", (q) =>
              q.eq("ruleSetId", targetRuleSetId),
            )
            .filter((q) => q.eq(q.field("name"), oldEntity.name))
            .first();

          if (!newEntity) {
            throw new Error(
              `Could not find location with name "${oldEntity.name}" in target rule set ${targetRuleSetId}. ` +
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

      if (node.conditionType === "APPOINTMENT_TYPE") {
        const remappedIds: string[] = [];
        for (const oldId of node.valueIds) {
          const oldEntity = await db.get(
            "appointmentTypes",
            oldId as Id<"appointmentTypes">,
          );

          if (!oldEntity) {
            throw new Error(
              `AppointmentType ${oldId} not found when remapping from rule set ${sourceRuleSetId} to ${targetRuleSetId}`,
            );
          }

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
          await validateAppointmentTypeIdsInRuleSet(
            db,
            node.valueIds,
            ruleSetId,
          );

          break;
        }
        case "CONCURRENT_COUNT":
        case "DAILY_CAPACITY": {
          // For CONCURRENT_COUNT and DAILY_CAPACITY, valueIds contains appointment type IDs
          // (scope is now a separate field)
          if (node.valueIds.length > 0) {
            await validateAppointmentTypeIdsInRuleSet(
              db,
              node.valueIds,
              ruleSetId,
            );
          }

          break;
        }
        case "LOCATION": {
          await validateLocationIdsInRuleSet(db, node.valueIds, ruleSetId);

          break;
        }
        case "PRACTITIONER": {
          await validatePractitionerIdsInRuleSet(db, node.valueIds, ruleSetId);

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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
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
  await db.delete("ruleConditions", nodeId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("ruleConditions", args.ruleId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForMutation(ctx, args.practiceId);
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get("ruleConditions", args.ruleId);
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

    await ctx.db.patch("ruleConditions", rule._id, updates);

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
  const node = await db.get("ruleConditions", nodeId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensureRuleSetAccessForQuery(ctx, args.ruleSetId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
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
    await ensureAuthenticatedIdentity(ctx);
    await ensurePracticeAccessForQuery(ctx, args.practiceId);
    const practice = await ctx.db.get("practices", args.practiceId);
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
