/**
 * Rule Engine - Evaluation of tree-based rule conditions
 *
 * This module provides functions to evaluate rule condition trees against appointment contexts.
 * The rule system uses a recursive tree structure with AND/NOT logical operators and leaf conditions.
 *
 * Key Functions:
 * - evaluateCondition: Evaluate a single leaf condition against appointment context
 * - evaluateConditionTree: Recursively evaluate a condition tree (with AND/NOT operators)
 * - checkRulesForAppointment: Main entry point - check all rules for an appointment
 */

import type { Infer } from "convex/values";

import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

import { internalQuery } from "./_generated/server";

/**
 * Validator for appointment context used in rule evaluation.
 * This is the data available when evaluating whether a rule should block an appointment.
 */
export const appointmentContextValidator = v.object({
  appointmentType: v.string(),
  // Client type (e.g., "Online", "MFA", "Phone-AI")
  clientType: v.optional(v.string()),
  // ISO datetime string
  dateTime: v.string(),
  locationId: v.optional(v.id("locations")),
  practiceId: v.id("practices"),
  practitionerId: v.id("practitioners"),
  // For DAYS_AHEAD conditions: when was this appointment requested?
  requestedAt: v.optional(v.string()), // ISO datetime string
});

/**
 * Type-safe appointment context derived from validator.
 */
export type AppointmentContext = Infer<typeof appointmentContextValidator>;

/**
 * Evaluate a single leaf condition against the appointment context.
 * Returns true if the condition matches (which may mean the appointment should be blocked).
 */
async function evaluateCondition(
  db: DatabaseReader,
  condition: Doc<"ruleConditions">,
  context: AppointmentContext,
): Promise<boolean> {
  // Only evaluate leaf conditions
  if (condition.nodeType !== "CONDITION") {
    throw new Error(
      `evaluateCondition called on non-CONDITION node: ${condition.nodeType}`,
    );
  }

  if (!condition.conditionType || !condition.operator) {
    throw new Error("Condition missing conditionType or operator");
  }

  const { conditionType, operator, valueIds, valueNumber } = condition;

  // Helper for comparing values
  const compareValue = (actual: number, expected: number): boolean => {
    switch (operator) {
      case "EQUALS": {
        return actual === expected;
      }
      case "GREATER_THAN_OR_EQUAL": {
        return actual >= expected;
      }
      case "LESS_THAN_OR_EQUAL": {
        return actual <= expected;
      }
      default: {
        return false;
      }
    }
  };

  // Helper for checking ID membership
  const checkIdMembership = (
    actualId: string | undefined,
    allowedIds: string[] | undefined,
  ): boolean => {
    if (!actualId || !allowedIds || allowedIds.length === 0) {
      return false;
    }
    const isInList = allowedIds.includes(actualId);
    return operator === "IS" ? isInList : !isInList; // IS_NOT inverts the result
  };

  switch (conditionType) {
    case "APPOINTMENT_TYPE": {
      // Compare appointment type string
      const isMatch =
        valueIds && valueIds.length > 0
          ? valueIds.includes(context.appointmentType)
          : false;
      return operator === "IS" ? isMatch : !isMatch;
    }

    case "CLIENT_TYPE": {
      // Compare client type (e.g., "Online", "MFA", "Phone-AI")
      const isMatch =
        valueIds && valueIds.length > 0 && context.clientType
          ? valueIds.includes(context.clientType)
          : false;
      return operator === "IS" ? isMatch : !isMatch;
    }

    case "CONCURRENT_COUNT": {
      // Check concurrent appointments at a specific time slot
      if (valueNumber === undefined) {
        return false;
      }

      // Query appointments that overlap with this time slot
      // For simplicity, we check appointments that start at the exact same time
      const existingAppointments = await db
        .query("appointments")
        .withIndex("by_start")
        .filter((q) =>
          q.and(
            q.eq(q.field("start"), context.dateTime),
            q.eq(q.field("practiceId"), context.practiceId),
            ...(context.locationId
              ? [q.eq(q.field("locationId"), context.locationId)]
              : []),
          ),
        )
        .collect();

      const currentCount = existingAppointments.length;
      return compareValue(currentCount, valueNumber);
    }

    case "DAILY_CAPACITY": {
      // Check if daily appointment limit is reached for this appointment type/practitioner/location
      if (valueNumber === undefined) {
        return false;
      }

      // Query existing appointments for the same day
      const appointmentDate = new Date(context.dateTime);
      const dayStart = new Date(appointmentDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(appointmentDate);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const existingAppointments = await db
        .query("appointments")
        .withIndex("by_start")
        .filter((q) =>
          q.and(
            q.gte(q.field("start"), dayStart.toISOString()),
            q.lte(q.field("start"), dayEnd.toISOString()),
            q.eq(q.field("practiceId"), context.practiceId),
            q.eq(q.field("appointmentType"), context.appointmentType),
            ...(context.practitionerId
              ? [q.eq(q.field("practitionerId"), context.practitionerId)]
              : []),
            ...(context.locationId
              ? [q.eq(q.field("locationId"), context.locationId)]
              : []),
          ),
        )
        .collect();

      const currentCount = existingAppointments.length;
      return compareValue(currentCount, valueNumber);
    }

    case "DATE_RANGE": {
      // Check if appointment date falls within a date range
      // valueIds should contain [startDate, endDate] as ISO strings
      if (valueIds?.length !== 2) {
        return false;
      }
      const appointmentDate = new Date(context.dateTime);
      const startDate = new Date(valueIds[0] ?? "");
      const endDate = new Date(valueIds[1] ?? "");
      const inRange =
        appointmentDate >= startDate && appointmentDate <= endDate;
      return operator === "IS" ? inRange : !inRange;
    }

    case "DAY_OF_WEEK": {
      // Compare day of week (0-6, Sunday=0)
      const appointmentDate = new Date(context.dateTime);
      const dayOfWeek = appointmentDate.getUTCDay();

      // Handle both old format (valueIds with day names) and new format (valueNumber)
      let targetDayOfWeek: number | undefined = valueNumber;

      // Backward compatibility: if valueNumber is undefined but valueIds has a day name, convert it
      if (targetDayOfWeek === undefined && valueIds && valueIds.length > 0) {
        const dayName = valueIds[0];
        const dayMap: Record<string, number> = {
          FRIDAY: 5,
          MONDAY: 1,
          SATURDAY: 6,
          SUNDAY: 0,
          THURSDAY: 4,
          TUESDAY: 2,
          WEDNESDAY: 3,
        };
        targetDayOfWeek = dayName ? dayMap[dayName] : undefined;
      }

      if (targetDayOfWeek === undefined) {
        return false;
      }

      // Handle both EQUALS (new format) and IS (old format) operators
      if (operator === "IS" || operator === "EQUALS") {
        return dayOfWeek === targetDayOfWeek;
      } else if (operator === "IS_NOT") {
        return dayOfWeek !== targetDayOfWeek;
      }

      return compareValue(dayOfWeek, targetDayOfWeek);
    }

    case "DAYS_AHEAD": {
      // Check how many days ahead the appointment is being booked
      if (valueNumber === undefined || !context.requestedAt) {
        return false;
      }
      const appointmentDate = new Date(context.dateTime);
      const requestDate = new Date(context.requestedAt);
      const daysAhead = Math.floor(
        (appointmentDate.getTime() - requestDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      return compareValue(daysAhead, valueNumber);
    }

    case "LOCATION": {
      // Compare location ID
      return checkIdMembership(context.locationId, valueIds);
    }

    case "PRACTITIONER": {
      // Compare practitioner ID
      return checkIdMembership(context.practitionerId, valueIds);
    }

    case "PRACTITIONER_TAG": {
      // Check if practitioner has a specific tag
      const practitioner = await db.get(context.practitionerId);
      if (!practitioner?.tags || !valueIds) {
        return false;
      }
      const hasTag = valueIds.some((tag) => practitioner.tags?.includes(tag));
      return operator === "IS" ? hasTag : !hasTag;
    }

    case "TIME_RANGE": {
      // Check if appointment time falls within a time range
      // valueIds should contain [startTime, endTime] in HH:MM format
      if (valueIds?.length !== 2) {
        return false;
      }
      const appointmentDate = new Date(context.dateTime);
      const hours = appointmentDate.getUTCHours();
      const minutes = appointmentDate.getUTCMinutes();
      const appointmentTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

      const startTime = valueIds[0] ?? "";
      const endTime = valueIds[1] ?? "";
      const inRange = appointmentTime >= startTime && appointmentTime < endTime;
      return operator === "IS" ? inRange : !inRange;
    }

    default: {
      // Unknown condition type - fail safe by not blocking
      console.warn(
        "Unknown condition type:",
        conditionType as string | undefined,
      );
      return false;
    }
  }
}

/**
 * Evaluate condition tree recursively.
 *
 * Recursively evaluates a condition tree starting from a given node.
 * Returns true if the tree evaluates to true (meaning the appointment should be blocked).
 *
 * Tree evaluation rules:
 * - AND: All children must be true.
 * - NOT: Inverts the single child result.
 * - CONDITION: Evaluate the leaf condition.
 * @param db Database reader for querying.
 * @param nodeId Root node ID of the condition tree.
 * @param context Appointment context for evaluation.
 * @returns True if the appointment should be blocked.
 */
async function evaluateConditionTree(
  db: DatabaseReader,
  nodeId: Id<"ruleConditions">,
  context: AppointmentContext,
): Promise<boolean> {
  const node = await db.get(nodeId);
  if (!node) {
    console.warn(`Condition node not found: ${nodeId}`);
    return false;
  }

  // If this is a leaf condition, evaluate it directly
  if (node.nodeType === "CONDITION") {
    return await evaluateCondition(db, node, context);
  }

  // Get ordered children
  const children = await db
    .query("ruleConditions")
    .withIndex("by_parentConditionId_childOrder", (q) =>
      q.eq("parentConditionId", nodeId),
    )
    .collect();

  if (children.length === 0) {
    console.warn(`Logical operator node has no children: ${nodeId}`);
    return false;
  }

  // Evaluate based on node type
  switch (node.nodeType) {
    case "AND": {
      // All children must be true
      for (const child of children) {
        const result = await evaluateConditionTree(db, child._id, context);
        if (!result) {
          return false; // Short-circuit: if any child is false, return false
        }
      }
      return true;
    }

    case "NOT": {
      // Invert the result of the single child
      if (children.length !== 1) {
        console.warn(
          `NOT node should have exactly 1 child, has ${children.length}: ${nodeId}`,
        );
        return false;
      }
      const child = children[0];
      if (!child) {
        return false;
      }
      const result = await evaluateConditionTree(db, child._id, context);
      return !result;
    }

    default: {
      console.warn(`Unknown node type: ${node.nodeType}`);
      return false;
    }
  }
}

/**
 * Check all rules in a rule set against an appointment context.
 * Returns the IDs of rules that would block the appointment, or an empty array if allowed.
 *
 * This is the main entry point for rule evaluation.
 */
export const checkRulesForAppointment = internalQuery({
  args: {
    context: appointmentContextValidator,
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    // Get all enabled root rules for this rule set
    const rules = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId_isRoot_enabled", (q) =>
        q
          .eq("ruleSetId", args.ruleSetId)
          .eq("isRoot", true)
          .eq("enabled", true),
      )
      .collect();

    const blockedByRuleIds: Id<"ruleConditions">[] = [];

    // Evaluate each rule
    for (const rule of rules) {
      // Get the first child of the root node (the actual condition tree)
      const rootChildren = await ctx.db
        .query("ruleConditions")
        .withIndex("by_parentConditionId_childOrder", (q) =>
          q.eq("parentConditionId", rule._id),
        )
        .collect();

      if (rootChildren.length === 0) {
        // Empty rule - skip
        continue;
      }

      // A root node should have exactly one child (the top of the condition tree)
      if (rootChildren.length !== 1) {
        console.warn(
          `Root rule node should have exactly 1 child, has ${rootChildren.length}: ${rule._id}`,
        );
        continue;
      }

      const rootChild = rootChildren[0];
      if (!rootChild) {
        continue;
      }

      // Evaluate the condition tree
      const isBlocked = await evaluateConditionTree(
        ctx.db,
        rootChild._id,
        args.context,
      );

      if (isBlocked) {
        blockedByRuleIds.push(rule._id);
      }
    }

    return {
      blockedByRuleIds,
      isBlocked: blockedByRuleIds.length > 0,
    };
  },
  returns: v.object({
    blockedByRuleIds: v.array(v.id("ruleConditions")),
    isBlocked: v.boolean(),
  }),
});

/**
 * Helper query to get a human-readable description of a rule and its condition tree.
 * Useful for debugging and displaying rule information in the UI.
 */
export const getRuleDescription = internalQuery({
  args: {
    ruleId: v.id("ruleConditions"),
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get(args.ruleId);
    if (!rule?.isRoot) {
      return {
        description: "Rule not found or not a root node",
        treeStructure: "",
      };
    }

    // Build tree structure recursively
    const buildTreeString = async (
      nodeId: Id<"ruleConditions">,
      depth = 0,
    ): Promise<string> => {
      const node = await ctx.db.get(nodeId);
      if (!node) {
        return "";
      }

      const indent = "  ".repeat(depth);
      let result = "";

      if (node.nodeType === "CONDITION") {
        // Leaf condition
        const valueStr =
          node.valueNumber === undefined
            ? node.valueIds
              ? `[${node.valueIds.join(", ")}]`
              : "[]"
            : `${node.valueNumber}`;
        result += `${indent}${node.conditionType} ${node.operator} ${valueStr}\n`;
      } else {
        // Logical operator
        result += `${indent}${node.nodeType}\n`;

        // Get and process children
        const children = await ctx.db
          .query("ruleConditions")
          .withIndex("by_parentConditionId_childOrder", (q) =>
            q.eq("parentConditionId", nodeId),
          )
          .collect();

        for (const child of children) {
          result += await buildTreeString(child._id, depth + 1);
        }
      }

      return result;
    };

    // Get the first child (root of condition tree)
    const rootChildren = await ctx.db
      .query("ruleConditions")
      .withIndex("by_parentConditionId_childOrder", (q) =>
        q.eq("parentConditionId", args.ruleId),
      )
      .collect();

    let treeStructure = "";
    if (rootChildren.length > 0 && rootChildren[0]) {
      treeStructure = await buildTreeString(rootChildren[0]._id);
    }

    return {
      description: `Rule ${args.ruleId} - ${rule.enabled ? "Enabled" : "Disabled"}`,
      treeStructure,
    };
  },
  returns: v.object({
    description: v.string(),
    treeStructure: v.string(),
  }),
});

/**
 * Validator for condition tree nodes used in rule creation/updates.
 * Note: Uses v.any() for recursive children array - we validate structure at runtime.
 */
export const conditionTreeNodeValidator = v.union(
  v.object({
    children: v.array(v.any()),
    nodeType: v.union(v.literal("AND"), v.literal("NOT")),
  }),
  v.object({
    conditionType: v.union(
      v.literal("APPOINTMENT_TYPE"),
      v.literal("DAY_OF_WEEK"),
      v.literal("LOCATION"),
      v.literal("PRACTITIONER"),
      v.literal("PRACTITIONER_TAG"),
      v.literal("DATE_RANGE"),
      v.literal("TIME_RANGE"),
      v.literal("DAYS_AHEAD"),
      v.literal("DAILY_CAPACITY"),
      v.literal("CONCURRENT_COUNT"),
      v.literal("CLIENT_TYPE"),
    ),
    nodeType: v.literal("CONDITION"),
    operator: v.union(
      v.literal("IS"),
      v.literal("IS_NOT"),
      v.literal("GREATER_THAN_OR_EQUAL"),
      v.literal("LESS_THAN_OR_EQUAL"),
      v.literal("EQUALS"),
    ),
    valueIds: v.optional(v.array(v.string())),
    valueNumber: v.optional(v.number()),
  }),
);

/**
 * Type for condition tree nodes, derived from validator.
 */
export type ConditionTreeNode = Infer<typeof conditionTreeNodeValidator>;

/**
 * Type guard to check if a node is a logical operator node (AND/NOT).
 */
function isLogicalNode(
  node: ConditionTreeNode,
): node is Extract<ConditionTreeNode, { nodeType: "AND" | "NOT" }> {
  return node.nodeType === "AND" || node.nodeType === "NOT";
}

/**
 * Type guard to check if a node is a condition leaf node.
 */
function isConditionNode(
  node: ConditionTreeNode,
): node is Extract<ConditionTreeNode, { nodeType: "CONDITION" }> {
  return node.nodeType === "CONDITION";
}

/**
 * Type guard to check if unknown value is a valid condition tree node.
 */
function isValidNode(value: unknown): value is ConditionTreeNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "nodeType" in value;
}

/**
 * Validate condition tree structure.
 *
 * Checks that a condition tree is well-formed before inserting it.
 * Returns validation errors, or empty array if valid.
 * @param node The condition tree node to validate.
 * @param depth Current recursion depth for infinite loop prevention.
 * @returns Array of validation error messages, or empty array if valid.
 */
export function validateConditionTree(
  node: ConditionTreeNode,
  depth = 0,
): string[] {
  const errors: string[] = [];

  // Prevent infinite recursion
  if (depth > 20) {
    errors.push("Condition tree is too deeply nested (max depth: 20)");
    return errors;
  }

  if (isConditionNode(node)) {
    // Validate leaf condition - conditionType and operator are guaranteed by type guard
    // Validate that at least one value is provided
    if (
      node.valueNumber === undefined &&
      (!node.valueIds || node.valueIds.length === 0)
    ) {
      errors.push("CONDITION node must have either valueNumber or valueIds");
    }
  } else if (isLogicalNode(node)) {
    // Validate logical operator - children array is guaranteed by type guard
    if (node.nodeType === "NOT" && node.children.length !== 1) {
      errors.push(
        `NOT node must have exactly 1 child, has ${node.children.length}`,
      );
    }
    if (node.nodeType === "AND" && node.children.length === 0) {
      errors.push("AND node must have at least 1 child");
    }
    // Recursively validate children
    for (let i = 0; i < node.children.length; i++) {
      const child: unknown = node.children[i];
      if (isValidNode(child)) {
        const childErrors = validateConditionTree(child, depth + 1);
        errors.push(...childErrors.map((err) => `Child ${i}: ${err}`));
      } else {
        errors.push(`Child ${i} is not a valid condition node`);
      }
    }
  } else {
    errors.push(
      `Unknown node type: ${String((node as { nodeType?: unknown }).nodeType)}`,
    );
  }

  return errors;
}
