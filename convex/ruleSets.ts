import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { findUnsavedRuleSet, validateRuleSet } from "./copyOnWrite";

// ================================
// RULE SET MANAGEMENT - SIMPLIFIED COW WORKFLOW
// ================================

/**
 * Saves an unsaved rule set by setting saved=true and updating the description.
 *
 * This is the EXIT POINT after making all desired changes.
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
    await ctx.db.patch(unsavedRuleSet._id, {
      description: args.description,
      saved: true,
    });

    // Optionally set as active
    if (args.setAsActive) {
      await ctx.db.patch(args.practiceId, {
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
    // Note: We still manually delete entities for explicit cleanup
    const ruleSetId = unsavedRuleSet._id;

    // Delete all entities belonging to this rule set
    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    for (const type of appointmentTypes) {
      await ctx.db.delete(type._id);
    }

    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    for (const practitioner of practitioners) {
      await ctx.db.delete(practitioner._id);
    }

    const locations = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    for (const location of locations) {
      await ctx.db.delete(location._id);
    }

    const baseSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    for (const schedule of baseSchedules) {
      await ctx.db.delete(schedule._id);
    }

    // Delete all rule conditions (rules) for this rule set
    const ruleConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", ruleSetId))
      .collect();
    for (const condition of ruleConditions) {
      await ctx.db.delete(condition._id);
    }

    // Finally, delete the rule set itself
    await ctx.db.delete(ruleSetId);
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
});

/**
 * Get all saved rule sets for a practice
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
    return await ctx.db.get(args.ruleSetId);
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
    await ctx.db.patch(args.practiceId, {
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
    const practice = await ctx.db.get(args.practiceId);
    if (!practice?.currentActiveRuleSetId) {
      return null;
    }
    return await ctx.db.get(practice.currentActiveRuleSetId);
  },
});

// ================================
// VERSION HISTORY FUNCTIONS
// ================================

/**
 * Get version history for a practice.
 * Returns all saved rule sets with metadata about which is active.
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

    const practice = await ctx.db.get(args.practiceId);

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
    const ruleSet = await ctx.db.get(args.ruleSetId);

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

    // Delete all rule conditions (rules) associated with this rule set
    const ruleConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    for (const condition of ruleConditions) {
      await ctx.db.delete(condition._id);
    }

    // Delete all entities associated with this rule set
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
    for (const practitioner of practitioners) {
      await ctx.db.delete(practitioner._id);
    }

    const locations = await ctx.db
      .query("locations")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
    for (const location of locations) {
      await ctx.db.delete(location._id);
    }

    const appointmentTypes = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
    for (const appointmentType of appointmentTypes) {
      await ctx.db.delete(appointmentType._id);
    }

    const baseSchedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
    for (const baseSchedule of baseSchedules) {
      await ctx.db.delete(baseSchedule._id);
    }

    // Finally, delete the rule set itself
    await ctx.db.delete(args.ruleSetId);
  },
});
