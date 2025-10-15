import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { conditionTreeValidator } from "./types";

// ================================
// RULE MANAGEMENT
// ================================

/**
 * Create a new scheduling rule
 */
export const createRule = mutation({
  args: {
    ruleSetId: v.id("ruleSets"),
    name: v.string(),
    description: v.optional(v.string()),
    priority: v.number(),
    condition: conditionTreeValidator,
    action: v.union(v.literal("BLOCK"), v.literal("ALLOW")),
    sideEffects: v.optional(v.any()),
    message: v.string(),
    enabled: v.optional(v.boolean()),
  },
  returns: v.id("rules"),
  handler: async (ctx, args) => {
    // Verify rule set exists
    const ruleSet = await ctx.db.get(args.ruleSetId);
    if (!ruleSet) {
      throw new Error("Rule set not found");
    }

    // Verify rule set is not saved (can only modify unsaved rule sets)
    if (ruleSet.saved) {
      throw new Error("Cannot add rules to a saved rule set");
    }

    // Create the rule
    const insertData: {
      ruleSetId: typeof args.ruleSetId;
      practiceId: typeof ruleSet.practiceId;
      name: string;
      description?: string;
      priority: number;
      condition: typeof args.condition;
      action: typeof args.action;
      sideEffects?: typeof args.sideEffects;
      message: string;
      enabled: boolean;
      createdAt: bigint;
      lastModified: bigint;
    } = {
      ruleSetId: args.ruleSetId,
      practiceId: ruleSet.practiceId,
      name: args.name,
      priority: args.priority,
      condition: args.condition,
      action: args.action,
      message: args.message,
      enabled: args.enabled ?? true,
      createdAt: BigInt(Date.now()),
      lastModified: BigInt(Date.now()),
    };

    if (args.description !== undefined) {
      insertData.description = args.description;
    }
    if (args.sideEffects !== undefined) {
      insertData.sideEffects = args.sideEffects;
    }

    const ruleId = await ctx.db.insert("rules", insertData);

    return ruleId;
  },
});

/**
 * Update an existing scheduling rule
 */
export const updateRule = mutation({
  args: {
    ruleId: v.id("rules"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(v.number()),
    condition: v.optional(conditionTreeValidator),
    action: v.optional(v.union(v.literal("BLOCK"), v.literal("ALLOW"))),
    sideEffects: v.optional(v.any()),
    message: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // Verify rule set is not saved
    const ruleSet = await ctx.db.get(rule.ruleSetId);
    if (!ruleSet) {
      throw new Error("Rule set not found");
    }
    if (ruleSet.saved) {
      throw new Error("Cannot modify rules in a saved rule set");
    }

    // Update the rule
    const updates: Record<string, unknown> = {
      lastModified: BigInt(Date.now()),
    };

    if (args.name !== undefined) {
      updates["name"] = args.name;
    }
    if (args.description !== undefined) {
      updates["description"] = args.description;
    }
    if (args.priority !== undefined) {
      updates["priority"] = args.priority;
    }
    if (args.condition !== undefined) {
      updates["condition"] = args.condition;
    }
    if (args.action !== undefined) {
      updates["action"] = args.action;
    }
    if (args.sideEffects !== undefined) {
      updates["sideEffects"] = args.sideEffects;
    }
    if (args.message !== undefined) {
      updates["message"] = args.message;
    }
    if (args.enabled !== undefined) {
      updates["enabled"] = args.enabled;
    }

    await ctx.db.patch(args.ruleId, updates);
    return null;
  },
});

/**
 * Delete a scheduling rule
 */
export const deleteRule = mutation({
  args: {
    ruleId: v.id("rules"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // Verify rule set is not saved
    const ruleSet = await ctx.db.get(rule.ruleSetId);
    if (!ruleSet) {
      throw new Error("Rule set not found");
    }
    if (ruleSet.saved) {
      throw new Error("Cannot delete rules from a saved rule set");
    }

    await ctx.db.delete(args.ruleId);
    return null;
  },
});

/**
 * List all rules for a rule set
 */
export const listRules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  returns: v.array(
    v.object({
      _id: v.id("rules"),
      _creationTime: v.number(),
      ruleSetId: v.id("ruleSets"),
      name: v.string(),
      description: v.optional(v.string()),
      priority: v.number(),
      condition: v.any(),
      action: v.union(v.literal("BLOCK"), v.literal("ALLOW")),
      sideEffects: v.optional(v.any()),
      message: v.string(),
      enabled: v.boolean(),
      createdAt: v.int64(),
      lastModified: v.int64(),
    }),
  ),
  handler: async (ctx, args) => {
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return rules;
  },
});

/**
 * Get a single rule by ID
 */
export const getRule = query({
  args: {
    ruleId: v.id("rules"),
  },
  returns: v.union(
    v.object({
      _id: v.id("rules"),
      _creationTime: v.number(),
      ruleSetId: v.id("ruleSets"),
      name: v.string(),
      description: v.optional(v.string()),
      priority: v.number(),
      condition: v.any(),
      action: v.union(v.literal("BLOCK"), v.literal("ALLOW")),
      sideEffects: v.optional(v.any()),
      message: v.string(),
      enabled: v.boolean(),
      createdAt: v.int64(),
      lastModified: v.int64(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    return rule ?? null;
  },
});

/**
 * Reorder rules (update priorities)
 */
export const reorderRules = mutation({
  args: {
    ruleSetId: v.id("ruleSets"),
    ruleOrder: v.array(
      v.object({
        ruleId: v.id("rules"),
        priority: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Verify rule set is not saved
    const ruleSet = await ctx.db.get(args.ruleSetId);
    if (!ruleSet) {
      throw new Error("Rule set not found");
    }
    if (ruleSet.saved) {
      throw new Error("Cannot reorder rules in a saved rule set");
    }

    // Update priorities
    for (const { ruleId, priority } of args.ruleOrder) {
      const rule = await ctx.db.get(ruleId);
      if (!rule) {
        throw new Error(`Rule ${ruleId} not found`);
      }
      if (rule.ruleSetId !== args.ruleSetId) {
        throw new Error(
          `Rule ${ruleId} does not belong to rule set ${args.ruleSetId}`,
        );
      }

      await ctx.db.patch(ruleId, {
        priority,
        lastModified: BigInt(Date.now()),
      });
    }

    return null;
  },
});

/**
 * Toggle rule enabled/disabled
 */
export const toggleRule = mutation({
  args: {
    ruleId: v.id("rules"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // Verify rule set is not saved
    const ruleSet = await ctx.db.get(rule.ruleSetId);
    if (!ruleSet) {
      throw new Error("Rule set not found");
    }
    if (ruleSet.saved) {
      throw new Error("Cannot toggle rules in a saved rule set");
    }

    const newEnabled = !rule.enabled;
    await ctx.db.patch(args.ruleId, {
      enabled: newEnabled,
      lastModified: BigInt(Date.now()),
    });

    return newEnabled;
  },
});

// ================================
// RULE VALIDATION HELPERS
// ================================

/**
 * Validate a condition tree structure
 * Returns an array of validation errors (empty if valid)
 */
export const validateConditionTree = query({
  args: {
    condition: conditionTreeValidator,
  },
  returns: v.array(v.string()),
  handler: async (_ctx, args) => {
    const errors: Array<string> = [];

    function validateNode(node: unknown, path: string): void {
      if (!node || typeof node !== "object") {
        errors.push(`${path}: Invalid node structure`);
        return;
      }

      const n = node as Record<string, unknown>;

      if (!n["type"] || typeof n["type"] !== "string") {
        errors.push(`${path}: Missing or invalid 'type' field`);
        return;
      }

      switch (n["type"]) {
        case "Property":
          if (
            !n["entity"] ||
            (n["entity"] !== "Slot" && n["entity"] !== "Context")
          ) {
            errors.push(`${path}: Invalid 'entity' field for Property`);
          }
          if (!n["attr"] || typeof n["attr"] !== "string") {
            errors.push(
              `${path}: Missing or invalid 'attr' field for Property`,
            );
          }
          if (!n["op"] || typeof n["op"] !== "string") {
            errors.push(`${path}: Missing or invalid 'op' field for Property`);
          }
          if (n["value"] === undefined) {
            errors.push(`${path}: Missing 'value' field for Property`);
          }
          break;

        case "Count":
          if (n["entity"] !== "Appointment") {
            errors.push(`${path}: Invalid 'entity' field for Count`);
          }
          if (!n["filter"] || typeof n["filter"] !== "object") {
            errors.push(`${path}: Missing or invalid 'filter' field for Count`);
          }
          if (!n["op"] || typeof n["op"] !== "string") {
            errors.push(`${path}: Missing or invalid 'op' field for Count`);
          }
          if (typeof n["value"] !== "number") {
            errors.push(`${path}: Missing or invalid 'value' field for Count`);
          }
          break;

        case "TimeRangeFree":
          if (n["start"] !== "Slot.start" && n["start"] !== "Slot.end") {
            errors.push(`${path}: Invalid 'start' field for TimeRangeFree`);
          }
          if (!n["duration"] || typeof n["duration"] !== "string") {
            errors.push(
              `${path}: Missing or invalid 'duration' field for TimeRangeFree`,
            );
          }
          break;

        case "Adjacent":
          if (n["entity"] !== "Appointment") {
            errors.push(`${path}: Invalid 'entity' field for Adjacent`);
          }
          if (!n["filter"] || typeof n["filter"] !== "object") {
            errors.push(
              `${path}: Missing or invalid 'filter' field for Adjacent`,
            );
          }
          if (n["direction"] !== "before" && n["direction"] !== "after") {
            errors.push(`${path}: Invalid 'direction' field for Adjacent`);
          }
          break;

        case "AND":
        case "OR":
          if (!Array.isArray(n["children"])) {
            errors.push(
              `${path}: Missing or invalid 'children' field for ${n["type"]}`,
            );
          } else {
            (n["children"] as Array<unknown>).forEach((child, i) => {
              validateNode(child, `${path}.children[${i}]`);
            });
          }
          break;

        case "NOT":
          if (!n["child"]) {
            errors.push(`${path}: Missing 'child' field for NOT`);
          } else {
            validateNode(n["child"], `${path}.child`);
          }
          break;

        default:
          errors.push(`${path}: Unknown condition type '${n["type"]}'`);
      }
    }

    validateNode(args.condition, "root");
    return errors;
  },
});
