import { v } from "convex/values";

import { api } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { ruleSetRuleUpdateValidator, ruleUpdateValidator } from "./validators";

// ================================
// RULE VALIDATION FUNCTIONS
// ================================

export const validateRuleName = query({
  args: {
    excludeRuleId: v.optional(v.id("rules")),
    name: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const existingRule = await ctx.db
      .query("rules")
      .withIndex("by_practiceId_name", (q) =>
        q.eq("practiceId", args.practiceId).eq("name", args.name),
      )
      .first();

    const isUnique = !existingRule || existingRule._id === args.excludeRuleId;

    return {
      isUnique,
      message: isUnique
        ? undefined
        : "Eine Regel mit diesem Namen existiert bereits. Bitte wählen Sie einen anderen Namen.",
    };
  },
  returns: v.object({
    isUnique: v.boolean(),
    message: v.optional(v.string()),
  }),
});

// ================================
// GLOBAL RULE MANAGEMENT
// ================================

export const createRule = mutation({
  args: {
    description: v.string(),
    name: v.string(),
    practiceId: v.id("practices"),
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
    // Check if rule name is unique
    const nameValidation = await ctx.runQuery(api.rules.validateRuleName, {
      name: args.name,
      practiceId: args.practiceId,
    });

    if (!nameValidation.isUnique) {
      throw new Error(nameValidation.message || "Rule name is not unique");
    }

    // Create the global rule
    const ruleData: Record<string, unknown> = {
      appliesTo: args.appliesTo,
      description: args.description,
      name: args.name,
      practiceId: args.practiceId,
      ruleType: args.ruleType,
    };

    // Add optional fields only if they have values
    if (args.specificPractitioners && args.specificPractitioners.length > 0) {
      ruleData["specificPractitioners"] = args.specificPractitioners;
    }
    if (args.block_appointmentTypes && args.block_appointmentTypes.length > 0) {
      ruleData["block_appointmentTypes"] = args.block_appointmentTypes;
    }
    if (args.block_dateRangeEnd) ruleData["block_dateRangeEnd"] = args.block_dateRangeEnd;
    if (args.block_dateRangeStart) ruleData["block_dateRangeStart"] = args.block_dateRangeStart;
    if (args.block_daysOfWeek && args.block_daysOfWeek.length > 0) {
      ruleData["block_daysOfWeek"] = args.block_daysOfWeek;
    }
    if (args.block_exceptForPractitionerTags && args.block_exceptForPractitionerTags.length > 0) {
      ruleData["block_exceptForPractitionerTags"] = args.block_exceptForPractitionerTags;
    }
    if (args.block_timeRangeEnd) ruleData["block_timeRangeEnd"] = args.block_timeRangeEnd;
    if (args.block_timeRangeStart) ruleData["block_timeRangeStart"] = args.block_timeRangeStart;
    if (args.limit_appointmentTypes && args.limit_appointmentTypes.length > 0) {
      ruleData["limit_appointmentTypes"] = args.limit_appointmentTypes;
    }
    if (args.limit_atLocation) ruleData["limit_atLocation"] = args.limit_atLocation;
    if (args.limit_count !== undefined) ruleData["limit_count"] = args.limit_count;
    if (args.limit_perPractitioner !== undefined) ruleData["limit_perPractitioner"] = args.limit_perPractitioner;

    const ruleId = await ctx.db.insert("rules", ruleData as Parameters<typeof ctx.db.insert<"rules">>[1]);

    return ruleId;
  },
  returns: v.id("rules"),
});

export const updateRule = mutation({
  args: {
    ruleId: v.id("rules"),
    updates: ruleUpdateValidator,
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // If name is being updated, check uniqueness
    if (args.updates.name && args.updates.name !== rule.name) {
      const nameValidation = await ctx.runQuery(api.rules.validateRuleName, {
        excludeRuleId: args.ruleId,
        name: args.updates.name,
        practiceId: rule.practiceId,
      });

      if (!nameValidation.isUnique) {
        throw new Error(nameValidation.message || "Rule name is not unique");
      }
    }

    // Filter out undefined values to avoid patch issues
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }

    await ctx.db.patch(args.ruleId, filteredUpdates);
    return { success: true };
  },
});

export const copyRule = mutation({
  args: {
    newName: v.string(),
    sourceRuleId: v.id("rules"),
  },
  handler: async (ctx, args) => {
    const sourceRule = await ctx.db.get(args.sourceRuleId);
    if (!sourceRule) {
      throw new Error("Source rule not found");
    }

    // Check if new name is unique
    const nameValidation = await ctx.runQuery(api.rules.validateRuleName, {
      name: args.newName,
      practiceId: sourceRule.practiceId,
    });

    if (!nameValidation.isUnique) {
      throw new Error(nameValidation.message || "Rule name is not unique");
    }

    // Create copy of the rule with new name
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

export const deleteRule = mutation({
  args: {
    ruleId: v.id("rules"),
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // Delete all ruleSetRules entries for this rule
    const ruleSetRules = await ctx.db
      .query("ruleSetRules")
      .withIndex("by_ruleId", (q) => q.eq("ruleId", args.ruleId))
      .collect();

    for (const ruleSetRule of ruleSetRules) {
      await ctx.db.delete(ruleSetRule._id);
    }

    // Delete the rule itself
    await ctx.db.delete(args.ruleId);
    return { success: true };
  },
});

export const getAllRulesForPractice = query({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_practiceId", (q) => q.eq("practiceId", args.practiceId))
      .collect();

    return rules.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// ================================
// RULE SET RULE MANAGEMENT (Junction Table)
// ================================

export const enableRuleInRuleSet = mutation({
  args: {
    priority: v.number(),
    ruleId: v.id("rules"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Check if the rule is already in this rule set
    const existingRuleSetRule = await ctx.db
      .query("ruleSetRules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .filter((q) => q.eq(q.field("ruleId"), args.ruleId))
      .first();

    if (existingRuleSetRule) {
      // Update existing entry to enabled
      await ctx.db.patch(existingRuleSetRule._id, {
        enabled: true,
        priority: args.priority,
      });
      return existingRuleSetRule._id;
    } else {
      // Create new entry
      const ruleSetRuleId = await ctx.db.insert("ruleSetRules", {
        enabled: true,
        priority: args.priority,
        ruleId: args.ruleId,
        ruleSetId: args.ruleSetId,
      });
      return ruleSetRuleId;
    }
  },
  returns: v.id("ruleSetRules"),
});

export const disableRuleInRuleSet = mutation({
  args: {
    ruleId: v.id("rules"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const ruleSetRule = await ctx.db
      .query("ruleSetRules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .filter((q) => q.eq(q.field("ruleId"), args.ruleId))
      .first();

    if (!ruleSetRule) {
      throw new Error("Rule is not in this rule set");
    }

    // Set to disabled instead of deleting
    await ctx.db.patch(ruleSetRule._id, { enabled: false });
    return { success: true };
  },
});

export const updateRuleSetRule = mutation({
  args: {
    ruleSetRuleId: v.id("ruleSetRules"),
    updates: ruleSetRuleUpdateValidator,
  },
  handler: async (ctx, args) => {
    const ruleSetRule = await ctx.db.get(args.ruleSetRuleId);
    if (!ruleSetRule) {
      throw new Error("RuleSetRule not found");
    }

    // Filter out undefined values
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }

    await ctx.db.patch(args.ruleSetRuleId, filteredUpdates);
    return { success: true };
  },
});

// ================================
// RULE SET QUERIES
// ================================

export const getRulesForRuleSet = query({
  args: {
    enabledOnly: v.optional(v.boolean()),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get ruleSetRules for this rule set
    let ruleSetRulesQuery = ctx.db
      .query("ruleSetRules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId));

    if (args.enabledOnly) {
      ruleSetRulesQuery = ruleSetRulesQuery.filter((q) =>
        q.eq(q.field("enabled"), true),
      );
    }

    const ruleSetRules = await ruleSetRulesQuery.collect();

    // Get the actual rules
    const rulesWithRuleSetInfo = await Promise.all(
      ruleSetRules.map(async (ruleSetRule) => {
        const rule = await ctx.db.get(ruleSetRule.ruleId);
        if (!rule) {
          return null;
        }
        return {
          ...rule,
          enabled: ruleSetRule.enabled,
          priority: ruleSetRule.priority,
          ruleSetRuleId: ruleSetRule._id,
        };
      }),
    );

    // Filter out null values and sort by priority
    return rulesWithRuleSetInfo
      .filter((rule) => rule !== null)
      .sort((a, b) => a.priority - b.priority);
  },
});

export const getAvailableRulesForRuleSet = query({
  args: {
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args): Promise<{
    [key: string]: unknown;
    _id: string;
    description: string;
    name: string;
    ruleType: "BLOCK" | "LIMIT_CONCURRENT";
  }[]> => {
    // Get all rules for this practice
    const allRules: {
      [key: string]: unknown;
      _id: string;
      description: string;
      name: string;
      ruleType: "BLOCK" | "LIMIT_CONCURRENT";
    }[] = await ctx.runQuery(api.rules.getAllRulesForPractice, {
      practiceId: args.practiceId,
    });

    // Get rules already in this rule set
    const ruleSetRules = await ctx.db
      .query("ruleSetRules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    const ruleIdsInRuleSet = new Set(
      ruleSetRules.map((rsr) => rsr.ruleId.toString()),
    );

    // Filter out rules already in the rule set
    return allRules.filter(
      (rule: (typeof allRules)[0]) => !ruleIdsInRuleSet.has(rule._id.toString()),
    );
  },
});

// ================================
// LEGACY COMPATIBILITY (for existing functionality)
// ================================

// Wrapper functions to maintain compatibility with existing code
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

    // Get the current active rule set
    const activeRuleSet = await ctx.db.get(practice.currentActiveRuleSetId);
    if (!activeRuleSet) {
      throw new Error("Active rule set not found");
    }

    // Create new draft rule set
    const newVersion = activeRuleSet.version + 1;
    const newRuleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      createdBy: "system", // TODO: Replace with actual user when auth is implemented
      description: args.description,
      practiceId: args.practiceId,
      version: newVersion,
    });

    // Copy all enabled rules from active set to new draft
    const activeRuleSetRules = await ctx.runQuery(
      api.rules.getRulesForRuleSet,
      {
        enabledOnly: true,
        ruleSetId: practice.currentActiveRuleSetId,
      },
    );

    for (const ruleWithInfo of activeRuleSetRules) {
      await ctx.runMutation(api.rules.enableRuleInRuleSet, {
        priority: ruleWithInfo.priority,
        ruleId: ruleWithInfo._id,
        ruleSetId: newRuleSetId,
      });
    }

    return newRuleSetId;
  },
  returns: v.id("ruleSets"),
});

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

    // Create new draft rule set
    const newVersion = sourceRuleSet.version + 1;
    const newRuleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      createdBy: "system", // TODO: Replace with actual user when auth is implemented
      description: args.description,
      practiceId: args.practiceId,
      version: newVersion,
    });

    // Copy all enabled rules from source set to new draft
    const sourceRuleSetRules = await ctx.runQuery(api.rules.getRulesForRuleSet, {
      enabledOnly: true,
      ruleSetId: args.sourceRuleSetId,
    });

    for (const ruleWithInfo of sourceRuleSetRules) {
      await ctx.runMutation(api.rules.enableRuleInRuleSet, {
        priority: ruleWithInfo.priority,
        ruleId: ruleWithInfo._id,
        ruleSetId: newRuleSetId,
      });
    }

    return newRuleSetId;
  },
  returns: v.id("ruleSets"),
});

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

    // Delete all ruleSetRules for this rule set
    const ruleSetRules = await ctx.db
      .query("ruleSetRules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    for (const ruleSetRule of ruleSetRules) {
      await ctx.db.delete(ruleSetRule._id);
    }

    // Delete the rule set itself
    await ctx.db.delete(args.ruleSetId);

    return { success: true };
  },
  returns: v.object({ success: v.boolean() }),
});

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

    // Create the first rule set with version 1 but DON'T activate it
    // User should be able to add rules before activating
    const newRuleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      createdBy: "system", // TODO: Replace with actual user when auth is implemented
      description: args.description,
      practiceId: args.practiceId,
      version: 1,
    });

    // Don't activate automatically - let user add rules and then activate
    // The rule set remains as a draft until user explicitly activates it

    return newRuleSetId;
  },
  returns: v.id("ruleSets"),
});

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

    return {
      isUnique,
      message: isUnique
        ? undefined
        : "Ein Regelset mit diesem Namen existiert bereits. Bitte wählen Sie einen anderen Namen.",
    };
  },
  returns: v.object({
    isUnique: v.boolean(),
    message: v.optional(v.string()),
  }),
});