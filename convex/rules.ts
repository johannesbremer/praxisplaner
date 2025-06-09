import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Rule management functions

/** Get all rules for a specific rule configuration */
export const getRulesForConfiguration = query({
  args: { ruleConfigurationId: v.id("ruleConfigurations") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rules")
      .withIndex("by_configuration_and_priority", (q) =>
        q.eq("ruleConfigurationId", args.ruleConfigurationId)
      )
      .order("asc")
      .collect();
  },
});

/** Get active rules for a specific rule configuration */
export const getActiveRulesForConfiguration = query({
  args: { ruleConfigurationId: v.id("ruleConfigurations") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rules")
      .withIndex("by_configuration_and_active", (q) =>
        q.eq("ruleConfigurationId", args.ruleConfigurationId).eq("active", true)
      )
      .collect();
  },
});

/** Create a new rule */
export const createRule = mutation({
  args: {
    ruleConfigurationId: v.id("ruleConfigurations"),
    name: v.string(),
    type: v.union(
      v.literal("CONDITIONAL_AVAILABILITY"),
      v.literal("RESOURCE_CONSTRAINT"),
      v.literal("SEASONAL_AVAILABILITY"),
      v.literal("TIME_BLOCK")
    ),
    priority: v.number(),
    active: v.boolean(),
    conditions: v.object({
      appointmentType: v.optional(v.string()),
      patientType: v.optional(v.string()),
      dateRange: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
      timeRange: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
      dayOfWeek: v.optional(v.array(v.number())),
      requiredResources: v.optional(v.array(v.string())),
    }),
    actions: v.object({
      requireExtraTime: v.optional(v.boolean()),
      extraMinutes: v.optional(v.number()),
      limitPerDay: v.optional(v.number()),
      requireSpecificDoctor: v.optional(v.string()),
      enableBatchAppointments: v.optional(v.boolean()),
      batchSize: v.optional(v.number()),
      batchDuration: v.optional(v.number()),
      blockTimeSlots: v.optional(v.array(v.string())),
    }),
  },
  returns: v.id("rules"),
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());
    
    return await ctx.db.insert("rules", {
      ...args,
      createdAt: now,
      lastModified: now,
    });
  },
});

/** Update an existing rule */
export const updateRule = mutation({
  args: {
    ruleId: v.id("rules"),
    name: v.optional(v.string()),
    type: v.optional(v.union(
      v.literal("CONDITIONAL_AVAILABILITY"),
      v.literal("RESOURCE_CONSTRAINT"),
      v.literal("SEASONAL_AVAILABILITY"),
      v.literal("TIME_BLOCK")
    )),
    priority: v.optional(v.number()),
    active: v.optional(v.boolean()),
    conditions: v.optional(v.object({
      appointmentType: v.optional(v.string()),
      patientType: v.optional(v.string()),
      dateRange: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
      timeRange: v.optional(v.object({
        start: v.string(),
        end: v.string(),
      })),
      dayOfWeek: v.optional(v.array(v.number())),
      requiredResources: v.optional(v.array(v.string())),
    })),
    actions: v.optional(v.object({
      requireExtraTime: v.optional(v.boolean()),
      extraMinutes: v.optional(v.number()),
      limitPerDay: v.optional(v.number()),
      requireSpecificDoctor: v.optional(v.string()),
      enableBatchAppointments: v.optional(v.boolean()),
      batchSize: v.optional(v.number()),
      batchDuration: v.optional(v.number()),
      blockTimeSlots: v.optional(v.array(v.string())),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { ruleId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );
    
    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(ruleId, {
        ...filteredUpdates,
        lastModified: BigInt(Date.now()),
      });
    }
    
    return null;
  },
});

/** Delete a rule */
export const deleteRule = mutation({
  args: { ruleId: v.id("rules") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.ruleId);
    return null;
  },
});

/** Toggle rule active status */
export const toggleRuleActive = mutation({
  args: { ruleId: v.id("rules") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }
    
    await ctx.db.patch(args.ruleId, {
      active: !rule.active,
      lastModified: BigInt(Date.now()),
    });
    
    return null;
  },
});