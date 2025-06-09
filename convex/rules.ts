import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// Rule management functions

/** Get all rules for a specific rule configuration */
export const getRulesForConfiguration = query({
  args: { ruleConfigurationId: v.id("ruleConfigurations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rules")
      .withIndex("by_configuration_and_priority", (q) =>
        q.eq("ruleConfigurationId", args.ruleConfigurationId),
      )
      .order("asc")
      .collect();
  },
  returns: v.array(v.any()),
});

/** Get active rules for a specific rule configuration */
export const getActiveRulesForConfiguration = query({
  args: { ruleConfigurationId: v.id("ruleConfigurations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rules")
      .withIndex("by_configuration_and_active", (q) =>
        q
          .eq("ruleConfigurationId", args.ruleConfigurationId)
          .eq("active", true),
      )
      .collect();
  },
  returns: v.array(v.any()),
});

/** Create a new rule */
export const createRule = mutation({
  args: {
    actions: v.object({
      batchDuration: v.optional(v.number()),
      batchSize: v.optional(v.number()),
      blockTimeSlots: v.optional(v.array(v.string())),
      enableBatchAppointments: v.optional(v.boolean()),
      extraMinutes: v.optional(v.number()),
      limitPerDay: v.optional(v.number()),
      requireExtraTime: v.optional(v.boolean()),
      requireSpecificDoctor: v.optional(v.string()),
    }),
    active: v.boolean(),
    conditions: v.object({
      appointmentType: v.optional(v.string()),
      dateRange: v.optional(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
      dayOfWeek: v.optional(v.array(v.number())),
      patientType: v.optional(v.string()),
      requiredResources: v.optional(v.array(v.string())),
      timeRange: v.optional(
        v.object({
          end: v.string(),
          start: v.string(),
        }),
      ),
    }),
    name: v.string(),
    priority: v.number(),
    ruleConfigurationId: v.id("ruleConfigurations"),
    type: v.union(
      v.literal("CONDITIONAL_AVAILABILITY"),
      v.literal("RESOURCE_CONSTRAINT"),
      v.literal("SEASONAL_AVAILABILITY"),
      v.literal("TIME_BLOCK"),
    ),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());

    return await ctx.db.insert("rules", {
      ...args,
      createdAt: now,
      lastModified: now,
    });
  },
  returns: v.id("rules"),
});

/** Update an existing rule */
export const updateRule = mutation({
  args: {
    actions: v.optional(
      v.object({
        batchDuration: v.optional(v.number()),
        batchSize: v.optional(v.number()),
        blockTimeSlots: v.optional(v.array(v.string())),
        enableBatchAppointments: v.optional(v.boolean()),
        extraMinutes: v.optional(v.number()),
        limitPerDay: v.optional(v.number()),
        requireExtraTime: v.optional(v.boolean()),
        requireSpecificDoctor: v.optional(v.string()),
      }),
    ),
    active: v.optional(v.boolean()),
    conditions: v.optional(
      v.object({
        appointmentType: v.optional(v.string()),
        dateRange: v.optional(
          v.object({
            end: v.string(),
            start: v.string(),
          }),
        ),
        dayOfWeek: v.optional(v.array(v.number())),
        patientType: v.optional(v.string()),
        requiredResources: v.optional(v.array(v.string())),
        timeRange: v.optional(
          v.object({
            end: v.string(),
            start: v.string(),
          }),
        ),
      }),
    ),
    name: v.optional(v.string()),
    priority: v.optional(v.number()),
    ruleId: v.id("rules"),
    type: v.optional(
      v.union(
        v.literal("CONDITIONAL_AVAILABILITY"),
        v.literal("RESOURCE_CONSTRAINT"),
        v.literal("SEASONAL_AVAILABILITY"),
        v.literal("TIME_BLOCK"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { ruleId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(ruleId, {
        ...filteredUpdates,
        lastModified: BigInt(Date.now()),
      });
    }

    return null;
  },
  returns: v.null(),
});

/** Delete a rule */
export const deleteRule = mutation({
  args: { ruleId: v.id("rules") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.ruleId);
    return null;
  },
  returns: v.null(),
});

/** Toggle rule active status */
export const toggleRuleActive = mutation({
  args: { ruleId: v.id("rules") },
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
  returns: v.null(),
});
