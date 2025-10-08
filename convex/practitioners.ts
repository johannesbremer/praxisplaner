import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  canModifyDirectly,
  validateEntityBelongsToRuleSet,
  validateRuleSetBelongsToPractice,
} from "./ruleSetValidation";
import { practitionerUpdateValidator } from "./validators";

export const createPractitioner = mutation({
  args: {
    name: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Verify the practice exists
    const practice = await ctx.db.get(args.practiceId);
    if (!practice) {
      throw new Error("Practice not found");
    }

    // Verify the rule set exists and belongs to this practice
    await validateRuleSetBelongsToPractice(
      ctx,
      args.ruleSetId,
      args.practiceId,
    );

    const practitionerData = {
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      ...(args.tags && { tags: args.tags }),
    };

    const practitionerId = await ctx.db.insert(
      "practitioners",
      practitionerData,
    );

    return practitionerId;
  },
  returns: v.id("practitioners"),
});

export const updatePractitioner = mutation({
  args: {
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
    updates: practitionerUpdateValidator,
  },
  handler: async (ctx, args) => {
    const fetchedPractitioner = await ctx.db.get(args.practitionerId);

    // Validate the entity and rule set - this also checks for null
    const practitioner = await validateEntityBelongsToRuleSet(
      ctx,
      fetchedPractitioner,
      "Practitioner",
      args.ruleSetId,
    );

    // Check if the practitioner already belongs to the target rule set
    if (canModifyDirectly(practitioner.ruleSetId, args.ruleSetId)) {
      // Same rule set - we can patch directly (for ungespeichert)
      const filteredUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(args.updates)) {
        filteredUpdates[key] = value;
      }
      await ctx.db.patch(args.practitionerId, filteredUpdates);
      return args.practitionerId;
    } else {
      // Different rule set - create a new practitioner (copy-on-write)
      const newPractitionerId = await ctx.db.insert("practitioners", {
        name: args.updates.name ?? practitioner.name,
        practiceId: practitioner.practiceId,
        ruleSetId: args.ruleSetId,
        ...(args.updates.tags === undefined
          ? practitioner.tags && { tags: practitioner.tags }
          : { tags: args.updates.tags }),
      });
      return newPractitionerId;
    }
  },
  returns: v.id("practitioners"),
});

export const deletePractitioner = mutation({
  args: {
    practitionerId: v.id("practitioners"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const fetchedPractitioner = await ctx.db.get(args.practitionerId);

    // Validate the entity and rule set
    const practitioner = await validateEntityBelongsToRuleSet(
      ctx,
      fetchedPractitioner,
      "Practitioner",
      args.ruleSetId,
    );

    // Check if the practitioner belongs to the target rule set
    if (!canModifyDirectly(practitioner.ruleSetId, args.ruleSetId)) {
      throw new Error(
        "Cannot delete practitioner from a different rule set. This practitioner will simply not be copied to the new rule set.",
      );
    }

    // Check if practitioner has any base schedules in this rule set
    const schedules = await ctx.db
      .query("baseSchedules")
      .withIndex("by_practitionerId", (q) =>
        q.eq("practitionerId", args.practitionerId),
      )
      .collect();

    const schedulesInRuleSet = schedules.filter(
      (s) => s.ruleSetId === args.ruleSetId,
    );

    if (schedulesInRuleSet.length > 0) {
      throw new Error(
        "Cannot delete practitioner with existing schedules. Please delete schedules first.",
      );
    }

    // Only allow deletion from the same rule set (typically ungespeichert)
    await ctx.db.delete(args.practitionerId);
    return null;
  },
  returns: v.null(),
});

/**
 * Get all practitioners in a specific rule set.
 * ruleSetId is required to prevent querying across all rule sets.
 */
export const getPractitioners = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return practitioners.toSorted((a, b) => a.name.localeCompare(b.name));
  },
});
