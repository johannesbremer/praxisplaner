import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// Rule configuration versioning functions

/** Get all rule configurations for a practice */
export const getRuleConfigurations = query({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_version", (q) =>
        q.eq("practiceId", args.practiceId),
      )
      .order("desc")
      .collect();
  },
  returns: v.array(v.any()),
});

/** Get the active rule configuration for a practice */
export const getActiveRuleConfiguration = query({
  args: { practiceId: v.id("practices") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("isActive", true),
      )
      .first();
  },
  returns: v.union(v.any(), v.null()),
});

/** Create a new rule configuration (copy-on-write from current active) */
export const createRuleConfiguration = mutation({
  args: {
    copyFromConfigurationId: v.optional(v.id("ruleConfigurations")),
    createdBy: v.string(),
    description: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());

    // Get the current max version for this practice
    const existingConfigs = await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_version", (q) =>
        q.eq("practiceId", args.practiceId),
      )
      .order("desc")
      .take(1);

    const nextVersion =
      existingConfigs.length > 0 && existingConfigs[0]
        ? existingConfigs[0].version + 1
        : 1;

    // Create new configuration
    const newConfigId = await ctx.db.insert("ruleConfigurations", {
      createdAt: now,
      createdBy: args.createdBy,
      description: args.description,
      isActive: false, // Will be activated separately
      practiceId: args.practiceId,
      version: nextVersion,
    });

    // Copy rules from existing configuration if specified
    if (args.copyFromConfigurationId) {
      const copyFromId = args.copyFromConfigurationId;
      const existingRules = await ctx.db
        .query("rules")
        .withIndex("by_configuration", (q) =>
          q.eq("ruleConfigurationId", copyFromId),
        )
        .collect();

      // Copy each rule to the new configuration
      for (const rule of existingRules) {
        await ctx.db.insert("rules", {
          actions: rule.actions,
          active: rule.active,
          conditions: rule.conditions,
          createdAt: now,
          lastModified: now,
          name: rule.name,
          priority: rule.priority,
          ruleConfigurationId: newConfigId,
          type: rule.type,
        });
      }
    }

    return newConfigId;
  },
  returns: v.id("ruleConfigurations"),
});

/** Activate a rule configuration (deactivates all others for the practice) */
export const activateRuleConfiguration = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleConfigurationId: v.id("ruleConfigurations"),
  },
  handler: async (ctx, args) => {
    // Deactivate all existing configurations for this practice
    const existingConfigs = await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("isActive", true),
      )
      .collect();

    for (const config of existingConfigs) {
      await ctx.db.patch(config._id, { isActive: false });
    }

    // Activate the new configuration
    await ctx.db.patch(args.ruleConfigurationId, { isActive: true });

    // Update the practice to point to the new active configuration
    await ctx.db.patch(args.practiceId, {
      currentActiveRuleConfigurationId: args.ruleConfigurationId,
      lastModified: BigInt(Date.now()),
    });

    return null;
  },
  returns: v.null(),
});

/** Get configuration details with rule count */
export const getRuleConfigurationWithStats = query({
  args: { ruleConfigurationId: v.id("ruleConfigurations") },
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.ruleConfigurationId);
    if (!config) {
      return null;
    }

    const rules = await ctx.db
      .query("rules")
      .withIndex("by_configuration", (q) =>
        q.eq("ruleConfigurationId", args.ruleConfigurationId),
      )
      .collect();

    return {
      ...config,
      activeRuleCount: rules.filter((rule) => rule.active).length,
      ruleCount: rules.length,
    };
  },
  returns: v.union(v.any(), v.null()),
});
