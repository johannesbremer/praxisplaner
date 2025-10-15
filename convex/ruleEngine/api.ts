import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { ConditionTree } from "./types";

import { mutation, query } from "../_generated/server";
import { getOrCreateUnsavedRuleSet } from "../copyOnWrite";
import { DataIntegrityError, RuleNotFoundError } from "./errors";
import { conditionTreeValidator } from "./types";

// ================================
// RULE MANAGEMENT
// ================================

// Type alias for create result (matches entities.ts pattern)
const createResultValidator = v.object({
  entityId: v.id("rules"),
  ruleSetId: v.id("ruleSets"),
});

/**
 * Create a new scheduling rule in an unsaved rule set.
 * Returns both the created entity ID and the rule set ID.
 */
export const createRule = mutation({
  args: {
    action: v.union(v.literal("BLOCK"), v.literal("ALLOW")),
    condition: conditionTreeValidator,
    description: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    message: v.string(),
    name: v.string(),
    practiceId: v.id("practices"),
    priority: v.number(),
    sideEffects: v.optional(v.any()),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Build the insert data
    const insertData: {
      action: "ALLOW" | "BLOCK";
      condition: ConditionTree;
      createdAt: bigint;
      description?: string;
      enabled: boolean;
      lastModified: bigint;
      message: string;
      name: string;
      practiceId: Id<"practices">;
      priority: number;
      ruleSetId: Id<"ruleSets">;
      sideEffects?: unknown;
    } = {
      action: args.action,
      condition: args.condition as ConditionTree,
      createdAt: BigInt(Date.now()),
      enabled: args.enabled ?? true,
      lastModified: BigInt(Date.now()),
      message: args.message,
      name: args.name,
      practiceId: args.practiceId,
      priority: args.priority,
      ruleSetId,
    };

    if (args.description !== undefined) {
      insertData.description = args.description;
    }
    if (args.sideEffects !== undefined) {
      insertData.sideEffects = args.sideEffects;
    }

    const entityId = await ctx.db.insert("rules", insertData);

    return { entityId, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Update an existing scheduling rule in an unsaved rule set
 */
export const updateRule = mutation({
  args: {
    action: v.optional(v.union(v.literal("BLOCK"), v.literal("ALLOW"))),
    condition: v.optional(conditionTreeValidator),
    description: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    message: v.optional(v.string()),
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
    priority: v.optional(v.number()),
    ruleId: v.id("rules"),
    sideEffects: v.optional(v.any()),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.ruleId);
    if (!entity) {
      throw new RuleNotFoundError(args.ruleId);
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let rule;
    if (entity.ruleSetId === ruleSetId) {
      rule = entity;
    } else {
      rule = await ctx.db
        .query("rules")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!rule) {
        throw new DataIntegrityError(
          "Rule not found in unsaved rule set. This should not happen.",
        );
      }
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
      updates["condition"] = args.condition as ConditionTree;
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

    await ctx.db.patch(rule._id, updates);

    return { entityId: rule._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * Delete a scheduling rule from an unsaved rule set
 */
export const deleteRule = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleId: v.id("rules"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.ruleId);
    if (!entity) {
      throw new RuleNotFoundError(args.ruleId);
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let rule;
    if (entity.ruleSetId === ruleSetId) {
      rule = entity;
    } else {
      rule = await ctx.db
        .query("rules")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!rule) {
        throw new DataIntegrityError(
          "Rule not found in unsaved rule set. This should not happen.",
        );
      }
    }

    await ctx.db.delete(rule._id);

    return { entityId: rule._id, ruleSetId };
  },
  returns: createResultValidator,
});

/**
 * List all rules for a rule set
 */
export const listRules = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    return rules;
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("rules"),
      action: v.union(v.literal("BLOCK"), v.literal("ALLOW")),
      condition: conditionTreeValidator,
      createdAt: v.int64(),
      description: v.optional(v.string()),
      enabled: v.boolean(),
      lastModified: v.int64(),
      message: v.string(),
      name: v.string(),
      parentId: v.optional(v.id("rules")),
      practiceId: v.id("practices"),
      priority: v.number(),
      ruleSetId: v.id("ruleSets"),
      sideEffects: v.optional(v.any()),
      zones: v.optional(v.any()),
    }),
  ),
});

/**
 * Get a single rule by ID
 */
export const getRule = query({
  args: {
    ruleId: v.id("rules"),
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    return rule ?? null;
  },
  returns: v.union(
    v.object({
      _creationTime: v.number(),
      _id: v.id("rules"),
      action: v.union(v.literal("BLOCK"), v.literal("ALLOW")),
      condition: conditionTreeValidator,
      createdAt: v.int64(),
      description: v.optional(v.string()),
      enabled: v.boolean(),
      lastModified: v.int64(),
      message: v.string(),
      name: v.string(),
      parentId: v.optional(v.id("rules")),
      practiceId: v.id("practices"),
      priority: v.number(),
      ruleSetId: v.id("ruleSets"),
      sideEffects: v.optional(v.any()),
      zones: v.optional(v.any()),
    }),
    v.null(),
  ),
});

/**
 * Reorder rules (update priorities)
 */
export const reorderRules = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleOrder: v.array(
      v.object({
        priority: v.number(),
        ruleId: v.id("rules"),
      }),
    ),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Update priorities for each rule
    for (const { priority, ruleId } of args.ruleOrder) {
      // Get the entity - it might be from the active or unsaved rule set
      const entity = await ctx.db.get(ruleId);
      if (!entity) {
        throw new RuleNotFoundError(ruleId);
      }

      // If it's already in the unsaved rule set, use it directly
      // Otherwise, find the copy by parentId
      let rule;
      if (entity.ruleSetId === ruleSetId) {
        rule = entity;
      } else {
        rule = await ctx.db
          .query("rules")
          .withIndex("by_parentId_ruleSetId", (q) =>
            q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
          )
          .first();

        if (!rule) {
          throw new DataIntegrityError(
            `Rule ${ruleId} not found in unsaved rule set. This should not happen.`,
          );
        }
      }

      await ctx.db.patch(rule._id, {
        lastModified: BigInt(Date.now()),
        priority,
      });
    }

    return { ruleSetId };
  },
  returns: v.object({ ruleSetId: v.id("ruleSets") }),
});

/**
 * Toggle rule enabled/disabled in an unsaved rule set
 */
export const toggleRule = mutation({
  args: {
    practiceId: v.id("practices"),
    ruleId: v.id("rules"),
    sourceRuleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(
      ctx.db,
      args.practiceId,
      args.sourceRuleSetId,
    );

    // Get the entity - it might be from the active or unsaved rule set
    const entity = await ctx.db.get(args.ruleId);
    if (!entity) {
      throw new RuleNotFoundError(args.ruleId);
    }

    // If it's already in the unsaved rule set, use it directly
    // Otherwise, find the copy by parentId
    let rule;
    if (entity.ruleSetId === ruleSetId) {
      rule = entity;
    } else {
      rule = await ctx.db
        .query("rules")
        .withIndex("by_parentId_ruleSetId", (q) =>
          q.eq("parentId", entity._id).eq("ruleSetId", ruleSetId),
        )
        .first();

      if (!rule) {
        throw new DataIntegrityError(
          "Rule not found in unsaved rule set. This should not happen.",
        );
      }
    }

    const newEnabled = !rule.enabled;
    await ctx.db.patch(rule._id, {
      enabled: newEnabled,
      lastModified: BigInt(Date.now()),
    });

    return { enabled: newEnabled, ruleSetId };
  },
  returns: v.object({
    enabled: v.boolean(),
    ruleSetId: v.id("ruleSets"),
  }),
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
  handler: (_ctx, args) => {
    const errors: string[] = [];

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
        case "Adjacent": {
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
        }

        case "AND":
        case "OR": {
          // Both AND and OR have the same validation: they need a children array
          if (Array.isArray(n["children"])) {
            for (const [i, child] of (n["children"] as unknown[]).entries()) {
              validateNode(child, `${path}.children[${i}]`);
            }
          } else {
            errors.push(
              `${path}: Missing or invalid 'children' field for ${n["type"]}`,
            );
          }
          break;
        }

        case "Count": {
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
        }

        case "NOT": {
          if (n["child"]) {
            validateNode(n["child"], `${path}.child`);
          } else {
            errors.push(`${path}: Missing 'child' field for NOT`);
          }
          break;
        }
        case "Property": {
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
        }

        case "TimeRangeFree": {
          if (n["start"] !== "Slot.start" && n["start"] !== "Slot.end") {
            errors.push(`${path}: Invalid 'start' field for TimeRangeFree`);
          }
          if (!n["duration"] || typeof n["duration"] !== "string") {
            errors.push(
              `${path}: Missing or invalid 'duration' field for TimeRangeFree`,
            );
          }
          break;
        }

        default: {
          errors.push(`${path}: Unknown condition type '${n["type"]}'`);
        }
      }
    }

    validateNode(args.condition, "root");
    return errors;
  },
  returns: v.array(v.string()),
});
