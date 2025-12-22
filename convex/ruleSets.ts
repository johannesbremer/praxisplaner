import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";

import { v } from "convex/values";

import type { DataModel, Id } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import { findUnsavedRuleSet, validateRuleSet } from "./copyOnWrite";
import { validateRuleSetDescriptionSync } from "./ruleSetValidation";

// ================================
// HELPER FUNCTIONS
// ================================

// Type aliases for cleaner code
type DatabaseReader = GenericDatabaseReader<DataModel>;
type DatabaseWriter = GenericDatabaseWriter<DataModel>;

/**
 * Get existing saved descriptions for a practice.
 * Used for validation.
 */
async function getExistingSavedDescriptions(
  db: DatabaseReader,
  practiceId: Id<"practices">,
): Promise<string[]> {
  const existingRuleSets = await db
    .query("ruleSets")
    .withIndex("by_practiceId_saved", (q) =>
      q.eq("practiceId", practiceId).eq("saved", true),
    )
    .collect();

  return existingRuleSets.map((rs) => rs.description);
}

/**
 * Delete appointment types by ruleSetId in batches.
 */
async function deleteAppointmentTypesByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("appointmentTypes")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("appointmentTypes", item._id);
    }
    batch = await db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete practitioners by ruleSetId in batches.
 */
async function deletePractitionersByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("practitioners")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("practitioners", item._id);
    }
    batch = await db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete locations by ruleSetId in batches.
 */
async function deleteLocationsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("locations")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("locations", item._id);
    }
    batch = await db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete base schedules by ruleSetId in batches.
 */
async function deleteBaseSchedulesByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("baseSchedules")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("baseSchedules", item._id);
    }
    batch = await db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

/**
 * Delete rule conditions by ruleSetId in batches.
 */
async function deleteRuleConditionsByRuleSet(
  db: DatabaseWriter,
  ruleSetId: Id<"ruleSets">,
  batchSize = 100,
): Promise<void> {
  let batch = await db
    .query("ruleConditions")
    .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
    .take(batchSize);

  while (batch.length > 0) {
    for (const item of batch) {
      await db.delete("ruleConditions", item._id);
    }
    batch = await db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .take(batchSize);
  }
}

// ================================
// RULE SET MANAGEMENT - SIMPLIFIED COW WORKFLOW
// ================================

/**
 * Saves an unsaved rule set by setting saved=true and updating the description.
 *
 * This is the EXIT POINT after making all desired changes.
 * - Validates that the description is valid and unique
 * - Validates that the rule set is currently unsaved
 * - Updates description and sets saved=true
 * - Optionally sets this as the active rule set for the practice
 */
export const saveUnsavedRuleSet = mutation({
  args: {
    description: v.string(),
    practiceId: v.id("practices"),
    setAsActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const trimmedDescription = args.description.trim();

    // Get existing saved descriptions for validation
    const existingDescriptions = await getExistingSavedDescriptions(
      ctx.db,
      args.practiceId,
    );

    // Validate the description using shared validation logic
    const validationResult = validateRuleSetDescriptionSync(
      trimmedDescription,
      existingDescriptions,
    );

    if (!validationResult.isValid) {
      throw new Error(validationResult.error);
    }

    // Find the unsaved rule set
    const unsavedRuleSet = await findUnsavedRuleSet(ctx.db, args.practiceId);

    if (!unsavedRuleSet) {
      throw new Error("No unsaved rule set exists for this practice");
    }

    // Validate it's actually unsaved
    if (unsavedRuleSet.saved) {
      throw new Error("Cannot save a rule set that is already saved");
    }

    // Update to saved state
    await ctx.db.patch("ruleSets", unsavedRuleSet._id, {
      description: trimmedDescription,
      saved: true,
    });

    // Optionally set as active
    if (args.setAsActive) {
      await ctx.db.patch("practices", args.practiceId, {
        currentActiveRuleSetId: unsavedRuleSet._id,
      });
    }

    return unsavedRuleSet._id;
  },
  returns: v.id("ruleSets"),
});

/**
 * Discards the unsaved rule set (delete it and all its entities).
 * This is useful for discarding unwanted changes.
 */
export const discardUnsavedRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Find the unsaved rule set
    const unsavedRuleSet = await findUnsavedRuleSet(ctx.db, args.practiceId);

    if (!unsavedRuleSet) {
      throw new Error("No unsaved rule set exists for this practice");
    }

    // Delete the rule set (entities will cascade via Convex deletion rules)
    // Note: We manually delete entities in batches for explicit cleanup
    const ruleSetId = unsavedRuleSet._id;

    // Delete all entities belonging to this rule set using batch processing
    await deleteAppointmentTypesByRuleSet(ctx.db, ruleSetId);
    await deletePractitionersByRuleSet(ctx.db, ruleSetId);
    await deleteLocationsByRuleSet(ctx.db, ruleSetId);
    await deleteBaseSchedulesByRuleSet(ctx.db, ruleSetId);
    await deleteRuleConditionsByRuleSet(ctx.db, ruleSetId);

    // Finally, delete the rule set itself
    await ctx.db.delete("ruleSets", ruleSetId);
  },
});

/**
 * Get the unsaved rule set for a practice (if it exists)
 */
export const getUnsavedRuleSet = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    return await findUnsavedRuleSet(ctx.db, args.practiceId);
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("ruleSets"),
      createdAt: v.number(),
      description: v.string(),
      parentVersion: v.optional(v.id("ruleSets")),
      practiceId: v.id("practices"),
      saved: v.boolean(),
      version: v.number(),
    }),
    v.null(),
  ),
});

/**
 * Get all saved rule sets for a practice
 * Note: Expected to have < 100 rule sets per practice (git-style versioning)
 */
export const getSavedRuleSets = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId_saved", (q) =>
        q.eq("practiceId", args.practiceId).eq("saved", true),
      )
      .collect();
  },
});

/**
 * Get all rule sets (saved and unsaved) for a practice.
 * Used for navigation and URL slug resolution.
 * Note: Expected to have < 100 rule sets per practice (git-style versioning)
 */
export const getAllRuleSets = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();
  },
});

/**
 * Get a specific rule set by ID
 */
export const getRuleSet = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("ruleSets", args.ruleSetId);
  },
});

/**
 * Set a rule set as the active rule set for a practice
 */
export const setActiveRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Validate the rule set exists and belongs to practice
    const ruleSet = await validateRuleSet(
      ctx.db,
      args.ruleSetId,
      args.practiceId,
    );

    // Only saved rule sets can be set as active
    if (!ruleSet.saved) {
      throw new Error("Cannot set an unsaved rule set as active");
    }

    // Update the practice
    await ctx.db.patch("practices", args.practiceId, {
      currentActiveRuleSetId: args.ruleSetId,
    });
  },
});

/**
 * Get the active rule set for a practice
 */
export const getActiveRuleSet = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const practice = await ctx.db.get("practices", args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return null;
    }
    return await ctx.db.get("ruleSets", practice.currentActiveRuleSetId);
  },
});

// ================================
// VERSION HISTORY FUNCTIONS
// ================================

/**
 * Get version history for a practice.
 * Returns all saved rule sets with metadata about which is active.
 * Note: Expected to have < 100 rule sets per practice (git-style versioning)
 */
export const getVersionHistory = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const ruleSets = await ctx.db
      .query("ruleSets")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      // Include all rule sets (saved and unsaved) for complete version history
      .collect();

    const practice = await ctx.db.get("practices", args.practiceId);

    return ruleSets.map((ruleSet) => ({
      createdAt: ruleSet.createdAt,
      id: ruleSet._id,
      isActive: practice?.currentActiveRuleSetId === ruleSet._id,
      message: ruleSet.description,
      parents: ruleSet.parentVersion ? [ruleSet.parentVersion] : [], // Convert single parent to array for visualization
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
 * Delete an unsaved rule set.
 * This is the ONLY way to delete a rule set - we never delete saved rule sets
 * (equivalent of rewriting git history).
 *
 * Use case: User wants to discard all unsaved changes and start fresh.
 */
export const deleteUnsavedRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const ruleSet = await ctx.db.get("ruleSets", args.ruleSetId);

    if (!ruleSet) {
      throw new Error("Rule set not found");
    }

    // Verify it belongs to the practice
    if (ruleSet.practiceId !== args.practiceId) {
      throw new Error("Rule set does not belong to this practice");
    }

    // CRITICAL: Only allow deleting unsaved rule sets
    if (ruleSet.saved) {
      throw new Error(
        "Cannot delete saved rule sets. Only unsaved rule sets can be deleted.",
      );
    }

    // Delete all entities associated with this rule set using batch processing
    await deleteRuleConditionsByRuleSet(ctx.db, args.ruleSetId);
    await deletePractitionersByRuleSet(ctx.db, args.ruleSetId);
    await deleteLocationsByRuleSet(ctx.db, args.ruleSetId);
    await deleteAppointmentTypesByRuleSet(ctx.db, args.ruleSetId);
    await deleteBaseSchedulesByRuleSet(ctx.db, args.ruleSetId);

    // Finally, delete the rule set itself
    await ctx.db.delete("ruleSets", args.ruleSetId);
  },
});
