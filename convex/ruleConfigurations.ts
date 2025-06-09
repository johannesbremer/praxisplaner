import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Rule configuration versioning functions

/** Get all rule configurations for a practice */
export const getRuleConfigurations = query({
  args: { practiceId: v.id("practices") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_version", (q) =>
        q.eq("practiceId", args.practiceId)
      )
      .order("desc")
      .collect();
  },
});

/** Get the active rule configuration for a practice */
export const getActiveRuleConfiguration = query({
  args: { practiceId: v.id("practices") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("isActive", true)
      )
      .first();
  },
});

/** Create a new rule configuration (copy-on-write from current active) */
export const createRuleConfiguration = mutation({
  args: {
    practiceId: v.id("practices"),
    description: v.string(),
    createdBy: v.string(),
    copyFromConfigurationId: v.optional(v.id("ruleConfigurations")),
  },
  returns: v.id("ruleConfigurations"),
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());
    
    // Get the current max version for this practice
    const existingConfigs = await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_version", (q) =>
        q.eq("practiceId", args.practiceId)
      )
      .order("desc")
      .take(1);
    
    const nextVersion = existingConfigs.length > 0 ? existingConfigs[0].version + 1 : 1;
    
    // Create new configuration
    const newConfigId = await ctx.db.insert("ruleConfigurations", {
      practiceId: args.practiceId,
      version: nextVersion,
      description: args.description,
      createdBy: args.createdBy,
      createdAt: now,
      isActive: false, // Will be activated separately
    });
    
    // Copy rules from existing configuration if specified
    if (args.copyFromConfigurationId) {
      const existingRules = await ctx.db
        .query("rules")
        .withIndex("by_configuration", (q) =>
          q.eq("ruleConfigurationId", args.copyFromConfigurationId)
        )
        .collect();
      
      // Copy each rule to the new configuration
      for (const rule of existingRules) {
        await ctx.db.insert("rules", {
          ruleConfigurationId: newConfigId,
          name: rule.name,
          type: rule.type,
          priority: rule.priority,
          active: rule.active,
          conditions: rule.conditions,
          actions: rule.actions,
          createdAt: now,
          lastModified: now,
        });
      }
    }
    
    return newConfigId;
  },
});

/** Activate a rule configuration (deactivates all others for the practice) */
export const activateRuleConfiguration = mutation({
  args: { 
    practiceId: v.id("practices"),
    ruleConfigurationId: v.id("ruleConfigurations") 
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Deactivate all existing configurations for this practice
    const existingConfigs = await ctx.db
      .query("ruleConfigurations")
      .withIndex("by_practice_and_active", (q) =>
        q.eq("practiceId", args.practiceId).eq("isActive", true)
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
});

/** Get configuration details with rule count */
export const getRuleConfigurationWithStats = query({
  args: { ruleConfigurationId: v.id("ruleConfigurations") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.ruleConfigurationId);
    if (!config) {
      return null;
    }
    
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_configuration", (q) =>
        q.eq("ruleConfigurationId", args.ruleConfigurationId)
      )
      .collect();
    
    return {
      ...config,
      ruleCount: rules.length,
      activeRuleCount: rules.filter(rule => rule.active).length,
    };
  },
});