import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

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

    // Copy all rules from active set to new draft
    if (!practice.currentActiveRuleSetId) {
      throw new Error("No active rule set found to copy from");
    }

    const activeRuleSetId = practice.currentActiveRuleSetId;
    const activeRules = await ctx.db
      .query("rules")

      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", activeRuleSetId))
      .collect();

    for (const rule of activeRules) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _creationTime, _id, ruleSetId, ...ruleData } = rule;
      await ctx.db.insert("rules", {
        ...ruleData,
        ruleSetId: newRuleSetId,
      });
    }

    return newRuleSetId;
  },
});

export const activateRuleSet = mutation({
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

    // Update the practice's active rule set
    await ctx.db.patch(args.practiceId, {
      currentActiveRuleSetId: args.ruleSetId,
    });

    return { success: true };
  },
});

export const updateRule = mutation({
  args: {
    ruleId: v.id("rules"),
    updates: v.object({
      description: v.optional(v.string()),
      priority: v.optional(v.number()),
      ruleType: v.optional(
        v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),
      ),

      // Block rule parameters
      block_appointmentTypes: v.optional(v.optional(v.array(v.string()))),
      block_dateRangeEnd: v.optional(v.optional(v.string())),
      block_dateRangeStart: v.optional(v.optional(v.string())),
      block_daysOfWeek: v.optional(v.optional(v.array(v.number()))),
      block_exceptForPractitionerTags: v.optional(
        v.optional(v.array(v.string())),
      ),
      block_timeRangeEnd: v.optional(v.optional(v.string())),
      block_timeRangeStart: v.optional(v.optional(v.string())),

      // Limit rule parameters
      limit_appointmentTypes: v.optional(v.optional(v.array(v.string()))),
      limit_atLocation: v.optional(v.optional(v.id("locations"))),
      limit_count: v.optional(v.optional(v.number())),
      limit_perPractitioner: v.optional(v.optional(v.boolean())),
    }),
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // Verify the rule set is not active (only allow editing drafts)
    const ruleSet = await ctx.db.get(rule.ruleSetId);
    if (!ruleSet) {
      throw new Error("Rule set not found");
    }

    const practice = await ctx.db.get(ruleSet.practiceId);
    if (practice?.currentActiveRuleSetId === rule.ruleSetId) {
      throw new Error(
        "Cannot edit rules in active rule set. Create a draft first.",
      );
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

export const createRule = mutation({
  args: {
    description: v.string(),
    priority: v.number(),
    ruleSetId: v.id("ruleSets"),
    ruleType: v.union(v.literal("BLOCK"), v.literal("LIMIT_CONCURRENT")),

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
    const ruleSet = await ctx.db.get(args.ruleSetId);
    if (!ruleSet) {
      throw new Error("Rule set not found");
    }

    // Verify the rule set is not active (only allow editing drafts)
    const practice = await ctx.db.get(ruleSet.practiceId);
    if (practice?.currentActiveRuleSetId === args.ruleSetId) {
      throw new Error(
        "Cannot add rules to active rule set. Create a draft first.",
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ruleSetId, ...ruleData } = args;
    const ruleId = await ctx.db.insert("rules", {
      ruleSetId: args.ruleSetId,
      ...ruleData,
    });

    return ruleId;
  },
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

    // Verify the rule set is not active (only allow editing drafts)
    const ruleSet = await ctx.db.get(rule.ruleSetId);
    if (!ruleSet) {
      throw new Error("Rule set not found");
    }

    const practice = await ctx.db.get(ruleSet.practiceId);
    if (practice?.currentActiveRuleSetId === rule.ruleSetId) {
      throw new Error(
        "Cannot delete rules from active rule set. Create a draft first.",
      );
    }

    await ctx.db.delete(args.ruleId);
    return { success: true };
  },
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

export const getRules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return rules.sort((a, b) => a.priority - b.priority);
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

    // Create the first rule set with version 1
    const newRuleSetId = await ctx.db.insert("ruleSets", {
      createdAt: Date.now(),
      createdBy: "system", // TODO: Replace with actual user when auth is implemented
      description: args.description,
      practiceId: args.practiceId,
      version: 1,
    });

    // Activate this rule set as the first one
    await ctx.db.patch(args.practiceId, {
      currentActiveRuleSetId: newRuleSetId,
    });

    return newRuleSetId;
  },
  returns: v.id("ruleSets"),
});
