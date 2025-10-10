import { v } from "convex/values";

import { api } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { validateRuleSetBelongsToPractice } from "./ruleSetValidation";
import { ruleUpdateValidator } from "./validators";

// ================================
// RULE VALIDATION FUNCTIONS
// ================================

export const validateRuleName = query({
  args: {
    excludeRuleId: v.optional(v.id("rules")),
    name: v.string(),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const existingRule = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", args.ruleSetId).eq("name", args.name),
      )
      .first();

    const isUnique = !existingRule || existingRule._id === args.excludeRuleId;

    if (isUnique) {
      return { isUnique };
    }

    return {
      isUnique,
      message:
        "Eine Regel mit diesem Namen existiert bereits. Bitte wählen Sie einen anderen Namen.",
    };
  },
  returns: v.object({
    isUnique: v.boolean(),
    message: v.optional(v.string()),
  }),
});

// ================================
// RULE MANAGEMENT (Copy-on-Write Pattern)
// ================================

/**
 * Create a new rule in a rule set.
 * Rules can only be created in the "ungespeichert" (unsaved) rule set.
 */
export const createRule = mutation({
  args: {
    description: v.string(),
    name: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
    ruleType: v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),

    // Practitioner application
    appliesTo: v.union(
      v.literal("ALL_PRACTITIONERS"),
      v.literal("SPECIFIC_PRACTITIONERS"),
    ),
    specificPractitioners: v.optional(v.array(v.id("practitioners"))),

    // Block rule parameters
    block_appointmentTypes: v.optional(v.array(v.string())),
    block_dateRangeEnd: v.optional(v.string()),
    block_dateRangeStart: v.optional(v.string()),
    block_daysOfWeek: v.optional(v.array(v.number())),
    block_exceptForPractitionerTags: v.optional(v.array(v.string())),
    block_timeRangeEnd: v.optional(v.string()),
    block_timeRangeStart: v.optional(v.string()),

    // Limit rule parameters
    limit_appointmentTypes: v.optional(v.array(v.string())),
    limit_atLocation: v.optional(v.id("locations")),
    limit_count: v.optional(v.number()),
    limit_perPractitioner: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Validate rule set ownership
    await validateRuleSetBelongsToPractice(
      ctx,
      args.ruleSetId,
      args.practiceId,
    );

    // Check if rule name is unique within the rule set
    const nameValidation = await ctx.runQuery(api.rules.validateRuleName, {
      name: args.name,
      ruleSetId: args.ruleSetId,
    });

    if (!nameValidation.isUnique) {
      throw new Error(nameValidation.message || "Rule name is not unique");
    }

    // Create the rule
    const ruleData: Record<string, unknown> = {
      appliesTo: args.appliesTo,
      description: args.description,
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
      ruleType: args.ruleType,
    };

    // Add optional fields only if they have values
    if (args.specificPractitioners && args.specificPractitioners.length > 0) {
      ruleData["specificPractitioners"] = args.specificPractitioners;
    }
    if (args.block_appointmentTypes && args.block_appointmentTypes.length > 0) {
      ruleData["block_appointmentTypes"] = args.block_appointmentTypes;
    }
    if (args.block_dateRangeEnd) {
      ruleData["block_dateRangeEnd"] = args.block_dateRangeEnd;
    }
    if (args.block_dateRangeStart) {
      ruleData["block_dateRangeStart"] = args.block_dateRangeStart;
    }
    if (args.block_daysOfWeek && args.block_daysOfWeek.length > 0) {
      ruleData["block_daysOfWeek"] = args.block_daysOfWeek;
    }
    if (
      args.block_exceptForPractitionerTags &&
      args.block_exceptForPractitionerTags.length > 0
    ) {
      ruleData["block_exceptForPractitionerTags"] =
        args.block_exceptForPractitionerTags;
    }
    if (args.block_timeRangeEnd) {
      ruleData["block_timeRangeEnd"] = args.block_timeRangeEnd;
    }
    if (args.block_timeRangeStart) {
      ruleData["block_timeRangeStart"] = args.block_timeRangeStart;
    }
    if (args.limit_appointmentTypes && args.limit_appointmentTypes.length > 0) {
      ruleData["limit_appointmentTypes"] = args.limit_appointmentTypes;
    }
    if (args.limit_atLocation) {
      ruleData["limit_atLocation"] = args.limit_atLocation;
    }
    if (args.limit_count !== undefined) {
      ruleData["limit_count"] = args.limit_count;
    }
    if (args.limit_perPractitioner !== undefined) {
      ruleData["limit_perPractitioner"] = args.limit_perPractitioner;
    }

    const ruleId = await ctx.db.insert(
      "rules",
      ruleData as Parameters<typeof ctx.db.insert<"rules">>[1],
    );

    return ruleId;
  },
  returns: v.id("rules"),
});

/**
 * Update a rule.
 * Rules can only be updated in the "ungespeichert" (unsaved) rule set.
 */
export const updateRule = mutation({
  args: {
    ruleId: v.id("rules"),
    ruleSetId: v.id("ruleSets"),
    updates: ruleUpdateValidator,
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // Validate rule set ownership
    await validateRuleSetBelongsToPractice(
      ctx,
      args.ruleSetId,
      rule.practiceId,
    );

    // Verify rule belongs to the specified rule set
    if (rule.ruleSetId !== args.ruleSetId) {
      throw new Error("Rule does not belong to the specified rule set");
    }

    // If name is being updated, check uniqueness within the rule set
    if (args.updates.name && args.updates.name !== rule.name) {
      const nameValidation = await ctx.runQuery(api.rules.validateRuleName, {
        excludeRuleId: args.ruleId,
        name: args.updates.name,
        ruleSetId: rule.ruleSetId,
      });

      if (!nameValidation.isUnique) {
        throw new Error(nameValidation.message || "Rule name is not unique");
      }
    }

    // Filter out undefined values to avoid patch issues
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.updates)) {
      filteredUpdates[key] = value;
    }

    await ctx.db.patch(args.ruleId, filteredUpdates);
    return { success: true };
  },
});

/**
 * Copy a rule within the same rule set.
 * Rules can only be copied within the "ungespeichert" (unsaved) rule set.
 */
export const copyRule = mutation({
  args: {
    newName: v.string(),
    ruleSetId: v.id("ruleSets"),
    sourceRuleId: v.id("rules"),
  },
  handler: async (ctx, args) => {
    const sourceRule = await ctx.db.get(args.sourceRuleId);
    if (!sourceRule) {
      throw new Error("Source rule not found");
    }

    // Validate rule set ownership
    await validateRuleSetBelongsToPractice(
      ctx,
      args.ruleSetId,
      sourceRule.practiceId,
    );

    // Verify source rule belongs to the specified rule set
    if (sourceRule.ruleSetId !== args.ruleSetId) {
      throw new Error("Source rule does not belong to the specified rule set");
    }

    // Check if new name is unique within the same rule set
    const nameValidation = await ctx.runQuery(api.rules.validateRuleName, {
      name: args.newName,
      ruleSetId: sourceRule.ruleSetId,
    });

    if (!nameValidation.isUnique) {
      throw new Error(nameValidation.message || "Rule name is not unique");
    }

    // Create copy of the rule with new name, exclude fields we don't need
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _creationTime, _id, name, ...ruleData } = sourceRule;
    const newRuleId = await ctx.db.insert("rules", {
      ...ruleData,
      name: args.newName,
    });

    return newRuleId;
  },
  returns: v.id("rules"),
});

/**
 * Delete a rule.
 * Rules can only be deleted from the "ungespeichert" (unsaved) rule set.
 */
export const deleteRule = mutation({
  args: {
    ruleId: v.id("rules"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // Validate rule set ownership
    await validateRuleSetBelongsToPractice(
      ctx,
      args.ruleSetId,
      rule.practiceId,
    );

    // Verify rule belongs to the specified rule set
    if (rule.ruleSetId !== args.ruleSetId) {
      throw new Error("Rule does not belong to the specified rule set");
    }

    // Delete the rule
    await ctx.db.delete(args.ruleId);
    return { success: true };
  },
});

// ================================
// RULE QUERIES
// ================================

/**
 * Get all rules for a specific rule set.
 * ruleSetId is required to prevent querying across all rule sets.
 */
export const getAllRulesForRuleSet = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return rules.toSorted((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Full-text search for rules by name and description within a specific rule set.
 */
export const searchRules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
    searchTerm: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    {
      [key: string]: unknown;
      _id: string;
      description: string;
      name: string;
      ruleType: "BLOCK" | "LIMIT_CONCURRENT";
    }[]
  > => {
    if (!args.searchTerm.trim()) {
      // Return all rules if no search term
      return await ctx.runQuery(api.rules.getAllRulesForRuleSet, {
        ruleSetId: args.ruleSetId,
      });
    }

    const rules = await ctx.db
      .query("rules")
      .withSearchIndex("search_rules", (q) =>
        q.search("name", args.searchTerm).eq("ruleSetId", args.ruleSetId),
      )
      .collect();

    // Also search in descriptions by filtering all rules for the rule set
    const allRules = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    const descriptionMatches = allRules.filter((rule) =>
      rule.description.toLowerCase().includes(args.searchTerm.toLowerCase()),
    );

    // Combine and deduplicate results
    const combined = [...rules, ...descriptionMatches];
    const uniqueRules = [
      ...new Map(combined.map((rule) => [rule._id, rule])).values(),
    ];

    return uniqueRules.toSorted((a, b) => a.name.localeCompare(b.name));
  },
});
