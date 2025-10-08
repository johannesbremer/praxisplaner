import { v } from "convex/values";

import { api } from "./_generated/api";
import { mutation, query } from "./_generated/server";

// ================================
// RULE SET MANAGEMENT
// ================================

/**
 * Creates a draft rule set from the currently active rule set.
 * Copies all enabled rules, practitioners, locations, appointment types, and base schedules.
 */
export const createDraftFromActive = mutation({
  args: {
    description: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get the current active rule set
    const practice = await ctx.db.get(args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      throw new Error("No active rule set found to copy from");
    }

    // Extract the active rule set ID to avoid non-null assertions
    const activeRuleSetId = practice.currentActiveRuleSetId;

    // Get the current active rule set
    const activeRuleSet = await ctx.db.get(activeRuleSetId);
    if (!activeRuleSet) {
      throw new Error("Active rule set not found");
    }

    // Create new draft rule set with parent relationship
    const newVersion = activeRuleSet.version + 1;
    const newRuleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      createdBy: "system", // TODO: Replace with actual user when auth is implemented
      description: args.description,
      parentVersions: [activeRuleSetId],
      practiceId: args.practiceId,
      version: newVersion,
    });

    // Copy all rules from active set to new draft
    const activeRules = await ctx.runQuery(api.rules.getAllRulesForRuleSet, {
      ruleSetId: activeRuleSetId,
    });

    for (const rule of activeRules) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _creationTime, _id, ruleSetId, ...ruleData } = rule;
      await ctx.db.insert("rules", {
        ...ruleData,
        ruleSetId: newRuleSetId,
      });
    }

    // Copy all practitioners
    const sourcePractitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", activeRuleSetId))
      .collect();

    const practitionerIdMap = new Map<
      (typeof sourcePractitioners)[0]["_id"],
      (typeof sourcePractitioners)[0]["_id"]
    >();

    for (const practitioner of sourcePractitioners) {
      const newPractitionerId = await ctx.db.insert("practitioners", {
        name: practitioner.name,
        practiceId: practitioner.practiceId,
        ruleSetId: newRuleSetId,
        ...(practitioner.tags && { tags: practitioner.tags }),
      });
      practitionerIdMap.set(practitioner._id, newPractitionerId);
    }

    // Copy all locations
    const sourceLocations = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", activeRuleSetId))
      .collect();

    const locationIdMap = new Map<
      (typeof sourceLocations)[0]["_id"],
      (typeof sourceLocations)[0]["_id"]
    >();

    for (const location of sourceLocations) {
      const newLocationId = await ctx.db.insert("locations", {
        name: location.name,
        practiceId: location.practiceId,
        ruleSetId: newRuleSetId,
      });
      locationIdMap.set(location._id, newLocationId);
    }

    // Copy all appointment types
    const sourceAppointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", activeRuleSetId))
      .collect();

    for (const appointmentType of sourceAppointmentTypes) {
      const newAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        createdAt: appointmentType.createdAt,
        lastModified: BigInt(Date.now()),
        name: appointmentType.name,
        practiceId: appointmentType.practiceId,
        ruleSetId: newRuleSetId,
      });

      // Copy durations
      const sourceDurations = await ctx.db
        .query("appointmentTypeDurations")
        .withIndex("by_appointmentType", (q) =>
          q.eq("appointmentTypeId", appointmentType._id),
        )
        .collect();

      for (const duration of sourceDurations) {
        const newPractitionerId = practitionerIdMap.get(
          duration.practitionerId,
        );
        if (newPractitionerId) {
          await ctx.db.insert("appointmentTypeDurations", {
            appointmentTypeId: newAppointmentTypeId,
            duration: duration.duration,
            practitionerId: newPractitionerId,
          });
        }
      }
    }

    // Copy all base schedules
    const sourceSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", activeRuleSetId))
      .collect();

    for (const schedule of sourceSchedules) {
      const newPractitionerId = practitionerIdMap.get(schedule.practitionerId);
      const newLocationId = locationIdMap.get(schedule.locationId);

      if (newPractitionerId && newLocationId) {
        await ctx.db.insert("baseSchedules", {
          dayOfWeek: schedule.dayOfWeek,
          endTime: schedule.endTime,
          locationId: newLocationId,
          practitionerId: newPractitionerId,
          ruleSetId: newRuleSetId,
          startTime: schedule.startTime,
          ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
        });
      }
    }

    return newRuleSetId;
  },
  returns: v.id("ruleSets"),
});

/**
 * Creates a draft rule set from any existing rule set (not just the active one).
 * Copies all enabled rules, practitioners, locations, appointment types, and base schedules.
 */
export const createDraftFromRuleSet = mutation({
  args: {
    description: v.string(),
    practiceId: v.id("practices"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get the source rule set
    const sourceRuleSet = await ctx.db.get(args.sourceRuleSetId);
    if (!sourceRuleSet) {
      throw new Error("Source rule set not found");
    }

    // Verify the rule set belongs to the practice
    if (sourceRuleSet.practiceId !== args.practiceId) {
      throw new Error("Rule set does not belong to this practice");
    }

    // Create new draft rule set with parent relationship
    const newVersion = sourceRuleSet.version + 1;
    const newRuleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      createdBy: "system", // TODO: Replace with actual user when auth is implemented
      description: args.description,
      parentVersions: [args.sourceRuleSetId],
      practiceId: args.practiceId,
      version: newVersion,
    });

    // Copy all rules from source set to new draft
    const sourceRules = await ctx.runQuery(api.rules.getAllRulesForRuleSet, {
      ruleSetId: args.sourceRuleSetId,
    });

    for (const rule of sourceRules) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _creationTime, _id, ruleSetId, ...ruleData } = rule;
      await ctx.db.insert("rules", {
        ...ruleData,
        ruleSetId: newRuleSetId,
      });
    }

    // Copy all practitioners
    const sourcePractitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.sourceRuleSetId))
      .collect();

    const practitionerIdMap = new Map<
      (typeof sourcePractitioners)[0]["_id"],
      (typeof sourcePractitioners)[0]["_id"]
    >();

    for (const practitioner of sourcePractitioners) {
      const newPractitionerId = await ctx.db.insert("practitioners", {
        name: practitioner.name,
        practiceId: practitioner.practiceId,
        ruleSetId: newRuleSetId,
        ...(practitioner.tags && { tags: practitioner.tags }),
      });
      practitionerIdMap.set(practitioner._id, newPractitionerId);
    }

    // Copy all locations
    const sourceLocations = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.sourceRuleSetId))
      .collect();

    const locationIdMap = new Map<
      (typeof sourceLocations)[0]["_id"],
      (typeof sourceLocations)[0]["_id"]
    >();

    for (const location of sourceLocations) {
      const newLocationId = await ctx.db.insert("locations", {
        name: location.name,
        practiceId: location.practiceId,
        ruleSetId: newRuleSetId,
      });
      locationIdMap.set(location._id, newLocationId);
    }

    // Copy all appointment types
    const sourceAppointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.sourceRuleSetId))
      .collect();

    for (const appointmentType of sourceAppointmentTypes) {
      const newAppointmentTypeId = await ctx.db.insert("appointmentTypes", {
        createdAt: appointmentType.createdAt,
        lastModified: BigInt(Date.now()),
        name: appointmentType.name,
        practiceId: appointmentType.practiceId,
        ruleSetId: newRuleSetId,
      });

      // Copy durations
      const sourceDurations = await ctx.db
        .query("appointmentTypeDurations")
        .withIndex("by_appointmentType", (q) =>
          q.eq("appointmentTypeId", appointmentType._id),
        )
        .collect();

      for (const duration of sourceDurations) {
        const newPractitionerId = practitionerIdMap.get(
          duration.practitionerId,
        );
        if (newPractitionerId) {
          await ctx.db.insert("appointmentTypeDurations", {
            appointmentTypeId: newAppointmentTypeId,
            duration: duration.duration,
            practitionerId: newPractitionerId,
          });
        }
      }
    }

    // Copy all base schedules
    const sourceSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.sourceRuleSetId))
      .collect();

    for (const schedule of sourceSchedules) {
      const newPractitionerId = practitionerIdMap.get(schedule.practitionerId);
      const newLocationId = locationIdMap.get(schedule.locationId);

      if (newPractitionerId && newLocationId) {
        await ctx.db.insert("baseSchedules", {
          dayOfWeek: schedule.dayOfWeek,
          endTime: schedule.endTime,
          locationId: newLocationId,
          practitionerId: newPractitionerId,
          ruleSetId: newRuleSetId,
          startTime: schedule.startTime,
          ...(schedule.breakTimes && { breakTimes: schedule.breakTimes }),
        });
      }
    }

    return newRuleSetId;
  },
  returns: v.id("ruleSets"),
});

/**
 * Activates a rule set and optionally renames it.
 */
export const activateRuleSet = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Verify the rule set belongs to this practice
    const ruleSet = await ctx.db.get(args.ruleSetId);
    if (!ruleSet || ruleSet.practiceId !== args.practiceId) {
      throw new Error("Rule set not found or doesn't belong to this practice");
    }

    // Update the rule set description with the new name
    await ctx.db.patch(args.ruleSetId, {
      description: args.name,
    });

    // Update the practice's active rule set
    await ctx.db.patch(args.practiceId, {
      currentActiveRuleSetId: args.ruleSetId,
    });

    return { success: true };
  },
  returns: v.object({ success: v.boolean() }),
});

/**
 * Deletes a rule set and all its associated data.
 * Cannot delete the currently active rule set.
 */
export const deleteRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Verify the rule set belongs to this practice
    const ruleSet = await ctx.db.get(args.ruleSetId);
    if (!ruleSet || ruleSet.practiceId !== args.practiceId) {
      throw new Error("Rule set not found or doesn't belong to this practice");
    }

    // Check if this is the active rule set
    const practice = await ctx.db.get(args.practiceId);
    if (practice?.currentActiveRuleSetId === args.ruleSetId) {
      throw new Error("Cannot delete the currently active rule set");
    }

    // Delete all rules for this rule set
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    for (const rule of rules) {
      await ctx.db.delete(rule._id);
    }

    // Delete all practitioners for this rule set
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    for (const practitioner of practitioners) {
      await ctx.db.delete(practitioner._id);
    }

    // Delete all locations for this rule set
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    for (const location of locations) {
      await ctx.db.delete(location._id);
    }

    // Delete all appointment types and their durations for this rule set
    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    for (const appointmentType of appointmentTypes) {
      // Delete all durations for this appointment type
      const durations = await ctx.db
        .query("appointmentTypeDurations")
        .withIndex("by_appointmentType", (q) =>
          q.eq("appointmentTypeId", appointmentType._id),
        )
        .collect();

      for (const duration of durations) {
        await ctx.db.delete(duration._id);
      }

      await ctx.db.delete(appointmentType._id);
    }

    // Delete all base schedules for this rule set
    const baseSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    for (const schedule of baseSchedules) {
      await ctx.db.delete(schedule._id);
    }

    // Delete the rule set itself
    await ctx.db.delete(args.ruleSetId);

    return { success: true };
  },
  returns: v.object({ success: v.boolean() }),
});

/**
 * Gets all rule sets for a practice with their active status.
 */
export const getRuleSets = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const ruleSets = await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const practice = await ctx.db.get(args.practiceId);

    return ruleSets.map((ruleSet) => ({
      ...ruleSet,
      isActive: practice?.currentActiveRuleSetId === ruleSet._id,
    }));
  },
});

/**
 * Gets the "Ungespeicherte Änderungen" (unsaved changes) rule set for a practice.
 * This is the working draft rule set that can be directly modified.
 */
export const getUnsavedRuleSet = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const practice = await ctx.db.get(args.practiceId);
    const ruleSets = await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    return ruleSets.find(
      (rs) =>
        rs._id !== practice?.currentActiveRuleSetId &&
        rs.description === "Ungespeicherte Änderungen",
    );
  },
});

/**
 * Gets the currently active rule set for a practice.
 * This is the published rule set used for actual appointments and scheduling.
 */
export const getActiveRuleSet = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const practice = await ctx.db.get(args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return;
    }
    return await ctx.db.get(practice.currentActiveRuleSetId);
  },
});

/**
 * Creates the initial rule set for a practice.
 * Can only be called if the practice has no existing rule sets.
 */
export const createInitialRuleSet = mutation({
  args: {
    description: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Check if practice already has any rule sets
    const existingRuleSets = await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    if (existingRuleSets.length > 0) {
      throw new Error(
        "Practice already has rule sets. Use createDraftFromActive instead.",
      );
    }

    // Create the first rule set with version 1 and no parents
    const newRuleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      createdBy: "system", // TODO: Replace with actual user when auth is implemented
      description: args.description,
      parentVersions: [], // Initial version has no parents
      practiceId: args.practiceId,
      version: 1,
    });

    // Don't activate automatically - let user add rules and then activate
    // The rule set remains as a draft until user explicitly activates it

    return newRuleSetId;
  },
  returns: v.id("ruleSets"),
});

/**
 * Validates that a rule set name is unique within a practice.
 */
export const validateRuleSetName = query({
  args: {
    excludeRuleSetId: v.optional(v.id("ruleSets")),
    name: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const existingRuleSet = await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId_description", (q) =>
        q.eq("practiceId", args.practiceId).eq("description", args.name),
      )
      .first();

    const isUnique =
      !existingRuleSet || existingRuleSet._id === args.excludeRuleSetId;

    if (isUnique) {
      return { isUnique };
    }

    return {
      isUnique,
      message:
        "Ein Regelset mit diesem Namen existiert bereits. Bitte wählen Sie einen anderen Namen.",
    };
  },
  returns: v.object({
    isUnique: v.boolean(),
    message: v.optional(v.string()),
  }),
});

// ================================
// VERSION HISTORY FUNCTIONS
// ================================

/**
 * Gets the version history for a practice's rule sets.
 */
export const getVersionHistory = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const ruleSets = await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    const practice = await ctx.db.get(args.practiceId);

    return ruleSets.map((ruleSet) => ({
      createdAt: ruleSet.createdAt,
      id: ruleSet._id,
      isActive: practice?.currentActiveRuleSetId === ruleSet._id,
      message: ruleSet.description,
      parents: ruleSet.parentVersions ?? [],
    }));
  },
  returns: v.array(
    v.object({
      createdAt: v.number(),
      id: v.id("ruleSets"),
      isActive: v.boolean(),
      message: v.string(),
      parents: v.array(v.id("ruleSets")),
    }),
  ),
});

/**
 * Creates a new version based on an existing version from history.
 */
export const createVersionFromHistory = mutation({
  args: {
    description: v.string(),
    practiceId: v.id("practices"),
    sourceVersionId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get the source version
    const sourceVersion = await ctx.db.get(args.sourceVersionId);
    if (!sourceVersion) {
      throw new Error("Source version not found");
    }

    // Verify the version belongs to the practice
    if (sourceVersion.practiceId !== args.practiceId) {
      throw new Error("Version does not belong to this practice");
    }

    // Create new version with the source as parent
    const newVersionId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      createdBy: "system", // TODO: Replace with actual user when auth is implemented
      description: args.description,
      parentVersions: [args.sourceVersionId],
      practiceId: args.practiceId,
      version: sourceVersion.version + 1,
    });

    // Copy all rules from source version to new version
    const sourceRules = await ctx.runQuery(api.rules.getAllRulesForRuleSet, {
      ruleSetId: args.sourceVersionId,
    });

    for (const rule of sourceRules) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _creationTime, _id, ruleSetId, ...ruleData } = rule;
      await ctx.db.insert("rules", {
        ...ruleData,
        ruleSetId: newVersionId,
      });
    }

    return newVersionId;
  },
  returns: v.id("ruleSets"),
});
