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
 * - buildPreloadedDayData: Pre-load all data needed for condition evaluation (called once per query)
 */

import type { Infer } from "convex/values";

import { v } from "convex/values";
import { Temporal } from "temporal-polyfill";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

import {
  conditionTreeToConditions,
  generateRuleName,
} from "../lib/rule-name-generator.js";
import { internalQuery } from "./_generated/server";

// ============================================================================
// Pre-loaded Data Types and Builder
// ============================================================================

/**
 * Pre-loaded data for efficient condition evaluation.
 * Built once per query execution before the slot loop, enabling O(1) lookups instead of per-slot DB queries.
 */
export interface PreloadedDayData {
  /**
   * All appointments for the day, for flexible filtering.
   * Used by CONCURRENT_COUNT which needs to filter by scope and appointment types.
   */
  appointments: Doc<"appointments">[];

  /**
   * Pre-computed daily capacity counts.
   * Key format: "appointmentTypeId:practitionerId:locationId" (use "undefined" for missing IDs)
   * Value: count of existing appointments matching that combination
   */
  dailyCapacityCounts: Map<string, number>;

  /**
   * Appointments grouped by start time for CONCURRENT_COUNT lookups.
   * Key: start time string (ISO ZonedDateTime)
   * Value: array of appointments starting at that time
   */
  appointmentsByStartTime: Map<string, Doc<"appointments">[]>;

  /**
   * Practitioners by ID for PRACTITIONER_TAG lookups.
   * Reuses practitioners already loaded by the caller.
   */
  practitioners: Map<Id<"practitioners">, Doc<"practitioners">>;
}

/**
 * Build pre-loaded data for a single day's condition evaluation.
 * This function should be called ONCE per query execution (e.g., getSlotsForDay), before the slot loop.
 * The "day" in the name refers to the date parameter, not a caching duration.
 * @param db Database reader
 * @param practiceId Practice to query appointments for
 * @param day Day as ISO date string (YYYY-MM-DD format)
 * @param practitioners Pre-loaded practitioners array (reuse from caller to avoid duplicate query)
 */
export async function buildPreloadedDayData(
  db: DatabaseReader,
  practiceId: Id<"practices">,
  day: string,
  practitioners: Doc<"practitioners">[],
): Promise<PreloadedDayData> {
  // Parse the day and compute day boundaries
  const plainDate = Temporal.PlainDate.from(day);
  const dayStartZdt = plainDate.toZonedDateTime({
    plainTime: new Temporal.PlainTime(0, 0),
    timeZone: "Europe/Berlin",
  });
  const dayEndZdt = plainDate.add({ days: 1 }).toZonedDateTime({
    plainTime: new Temporal.PlainTime(0, 0),
    timeZone: "Europe/Berlin",
  });

  const dayStartStr = dayStartZdt.toString();
  const dayEndStr = dayEndZdt.toString();

  // Query appointments for this practice and day only
  // Use compound index by_practiceId_start with both bounds for efficient filtering
  const appointments = await db
    .query("appointments")
    .withIndex("by_practiceId_start", (q) =>
      q
        .eq("practiceId", practiceId)
        .gte("start", dayStartStr)
        .lt("start", dayEndStr),
    )
    .collect();

  // Build daily capacity counts map
  // Key: "appointmentTypeId:practitionerId:locationId"
  const dailyCapacityCounts = new Map<string, number>();
  for (const apt of appointments) {
    const key = `${apt.appointmentTypeId}:${apt.practitionerId ?? "undefined"}:${apt.locationId}`;
    dailyCapacityCounts.set(key, (dailyCapacityCounts.get(key) ?? 0) + 1);
  }

  // Build appointments by start time map for CONCURRENT_COUNT
  const appointmentsByStartTime = new Map<string, Doc<"appointments">[]>();
  for (const apt of appointments) {
    const existing = appointmentsByStartTime.get(apt.start) ?? [];
    existing.push(apt);
    appointmentsByStartTime.set(apt.start, existing);
  }

  // Build practitioners map from passed-in array
  const practitionersMap = new Map<Id<"practitioners">, Doc<"practitioners">>();
  for (const practitioner of practitioners) {
    practitionersMap.set(practitioner._id, practitioner);
  }

  return {
    appointments,
    appointmentsByStartTime,
    dailyCapacityCounts,
    practitioners: practitionersMap,
  };
}

/**
 * Validator for appointment context used in rule evaluation.
 * This is the data available when evaluating whether a rule should block an appointment.
 */
export const appointmentContextValidator = v.object({
  appointmentTypeId: v.id("appointmentTypes"),
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
 * Day-invariant condition types - these only depend on the date and fixed query context,
 * not time-of-day or per-slot variations, AND don't require database reads beyond initial
 * rule/condition loading. These can be pre-evaluated once per getSlotsForDay call.
 *
 * INCLUDED (query-invariant, no DB reads, fixed per query execution):
 * - APPOINTMENT_TYPE: Fixed in simulatedContext for entire query
 * - LOCATION: Fixed in simulatedContext for entire query
 * - CLIENT_TYPE: Fixed (patient.isNew) for entire query
 * - DATE_RANGE, DAY_OF_WEEK, DAYS_AHEAD: Only depend on the target date
 *
 * EXCLUDED conditions (vary per slot OR require DB reads during evaluation):
 * - PRACTITIONER: Varies per slot (different practitioner columns in staff view)
 * - DAILY_CAPACITY: Queries appointments table to count existing appointments
 * - PRACTITIONER_TAG: Queries practitioner document to check tags
 * - CONCURRENT_COUNT: Queries appointments table (also time-variant)
 */
const DAY_INVARIANT_CONDITION_TYPES = new Set([
  "APPOINTMENT_TYPE",
  "CLIENT_TYPE",
  "DATE_RANGE",
  "DAY_OF_WEEK",
  "DAYS_AHEAD",
  "LOCATION",
]);

/**
 * Evaluate a single leaf condition against the appointment context.
 * Returns true if the condition matches (which may mean the appointment should be blocked).
 * @param condition The condition to evaluate
 * @param context Appointment context
 * @param preloadedData Pre-loaded data for O(1) lookups (required for DAILY_CAPACITY, CONCURRENT_COUNT, PRACTITIONER_TAG)
 */
function evaluateCondition(
  condition: Doc<"ruleConditions">,
  context: AppointmentContext,
  preloadedData: PreloadedDayData,
): boolean {
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
      // Compare appointment type IDs
      const isMatch =
        valueIds && valueIds.length > 0
          ? valueIds.includes(context.appointmentTypeId)
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
      // scope: "practice", "location", or "practitioner"
      // valueIds: optional list of appointment types to count
      // valueNumber: the count threshold
      if (valueNumber === undefined) {
        return false;
      }

      const scope = condition.scope;
      const appointmentTypeIds = valueIds ?? [];

      // Use pre-loaded appointments grouped by start time - O(1) lookup
      // Note: appointments are already filtered by practiceId in buildPreloadedDayData
      const appointmentsAtTime =
        preloadedData.appointmentsByStartTime.get(context.dateTime) ?? [];

      let filteredAppointments = appointmentsAtTime;

      // Apply scope-based filtering
      if (scope === "location" && context.locationId) {
        filteredAppointments = filteredAppointments.filter(
          (apt) => apt.locationId === context.locationId,
        );
      } else if (scope === "practitioner") {
        filteredAppointments = filteredAppointments.filter(
          (apt) => apt.practitionerId === context.practitionerId,
        );
      }
      // "practice" scope means no additional filtering - count across entire practice

      // Filter by appointment types if specified
      if (appointmentTypeIds.length > 0) {
        filteredAppointments = filteredAppointments.filter((apt) =>
          apt.appointmentTypeId
            ? appointmentTypeIds.includes(apt.appointmentTypeId)
            : false,
        );
      }

      // Count existing appointments + 1 for the appointment being evaluated
      // This represents "if this appointment were booked, how many concurrent would there be?"
      const currentCount = filteredAppointments.length + 1;
      return compareValue(currentCount, valueNumber);
    }

    case "DAILY_CAPACITY": {
      // Check if daily appointment limit is reached for this appointment type/practitioner/location
      if (valueNumber === undefined) {
        return false;
      }

      // Use pre-computed daily capacity counts - O(1) lookup
      // Key format: "appointmentTypeId:practitionerId:locationId"
      // Note: When context.locationId is undefined, this will find no matches (returns 0),
      // which is correct since appointments always have a locationId in the schema.
      const key = `${context.appointmentTypeId}:${context.practitionerId}:${context.locationId ?? "undefined"}`;
      const currentCount = preloadedData.dailyCapacityCounts.get(key) ?? 0;
      return compareValue(currentCount, valueNumber);
    }

    case "DATE_RANGE": {
      // Check if appointment date falls within a date range
      // valueIds should contain [startDate, endDate] as PlainDate ISO strings (YYYY-MM-DD)
      if (valueIds?.length !== 2) {
        return false;
      }
      const appointmentZoned = Temporal.ZonedDateTime.from(context.dateTime);
      const appointmentDate = appointmentZoned.toPlainDate();
      const startDate = Temporal.PlainDate.from(valueIds[0] ?? "");
      const endDate = Temporal.PlainDate.from(valueIds[1] ?? "");
      const inRange =
        Temporal.PlainDate.compare(appointmentDate, startDate) >= 0 &&
        Temporal.PlainDate.compare(appointmentDate, endDate) <= 0;
      return operator === "IS" ? inRange : !inRange;
    }

    case "DAY_OF_WEEK": {
      // Compare day of week (1-7, Monday=1, Sunday=7 per ISO 8601)
      const appointmentZoned = Temporal.ZonedDateTime.from(context.dateTime);
      const dayOfWeek = appointmentZoned.dayOfWeek; // ISO: 1=Monday, 7=Sunday

      // Handle both old format (valueIds with day names) and new format (valueNumber)
      let targetDayOfWeek: number | undefined = valueNumber;

      // Backward compatibility: if valueNumber is undefined but valueIds has a day name, convert it
      // Using ISO 8601 format: 1=Monday, 7=Sunday
      if (targetDayOfWeek === undefined && valueIds && valueIds.length > 0) {
        const dayName = valueIds[0];
        const dayMap: Record<string, number> = {
          FRIDAY: 5,
          MONDAY: 1,
          SATURDAY: 6,
          SUNDAY: 7, // ISO 8601: Sunday is 7, not 0
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
      const appointmentZoned = Temporal.ZonedDateTime.from(context.dateTime);
      const requestZoned = Temporal.ZonedDateTime.from(context.requestedAt);

      // Calculate days difference using PlainDate for accurate day counting
      const appointmentDate = appointmentZoned.toPlainDate();
      const requestDate = requestZoned.toPlainDate();
      const daysAhead = appointmentDate.since(requestDate).days;

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
      // Check if practitioner has a specific tag - O(1) lookup
      const practitioner = preloadedData.practitioners.get(
        context.practitionerId,
      );
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
      const appointmentZoned = Temporal.ZonedDateTime.from(context.dateTime);
      const hours = appointmentZoned.hour;
      const minutes = appointmentZoned.minute;
      const appointmentTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

      const startTime = valueIds[0] ?? "";
      const endTime = valueIds[1] ?? "";
      const inRange = appointmentTime >= startTime && appointmentTime < endTime;
      return operator === "IS" ? inRange : !inRange;
    }

    default: {
      // Unknown condition type - this indicates data corruption
      throw new Error(
        `Unknown condition type: ${conditionType as string | undefined}. ` +
          `This indicates data corruption in rule conditions.`,
      );
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
 * - AND: All children must be true (short-circuits on first false).
 * - NOT: Inverts the single child result.
 * - CONDITION: Evaluate the leaf condition.
 * @param nodeId Root node ID of the condition tree.
 * @param context Appointment context for evaluation.
 * @param preloadedData Pre-loaded appointment data for fast lookups (required).
 * @param conditionsMap Map of pre-loaded conditions for fast lookup (required).
 * @param allConditions Array of all pre-loaded conditions for children lookup (required).
 * @returns True if the appointment should be blocked.
 */
function evaluateConditionTree(
  nodeId: Id<"ruleConditions">,
  context: AppointmentContext,
  preloadedData: PreloadedDayData,
  conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>,
  allConditions: Doc<"ruleConditions">[],
): boolean {
  // Inner recursive function that uses the preloaded data
  const evaluateTreeInternal = (id: Id<"ruleConditions">): boolean => {
    // Use cached node from conditionsMap
    const node = conditionsMap.get(id);
    if (!node) {
      throw new Error(
        `Condition node not found in conditionsMap: ${id}. ` +
          `All conditions must be pre-loaded for evaluation.`,
      );
    }

    // If this is a leaf condition, evaluate it directly
    if (node.nodeType === "CONDITION") {
      return evaluateCondition(node, context, preloadedData);
    }

    // Get ordered children from pre-loaded conditions
    const children = allConditions
      .filter((c) => c.parentConditionId === id)
      .toSorted((a, b) => a.childOrder - b.childOrder);

    if (children.length === 0) {
      throw new Error(
        `Logical operator node has no children: ${id}. ` +
          `This indicates data corruption - AND/NOT nodes must have children.`,
      );
    }

    // Evaluate based on node type
    switch (node.nodeType) {
      case "AND": {
        // All children must be true - SHORT CIRCUIT on first false
        for (const child of children) {
          const result = evaluateTreeInternal(child._id);
          if (!result) {
            return false; // Short-circuit: if any child is false, return false
          }
        }
        return true;
      }

      case "NOT": {
        // Invert the result of the single child
        if (children.length !== 1) {
          throw new Error(
            `NOT node should have exactly 1 child, has ${children.length}: ${id}. ` +
              `This indicates data corruption.`,
          );
        }
        const child = children[0];
        if (!child) {
          return false;
        }
        const result = evaluateTreeInternal(child._id);
        return !result;
      }

      default: {
        throw new Error(
          `Unknown node type: ${node.nodeType}. ` +
            `This indicates data corruption in rule condition tree.`,
        );
      }
    }
  };

  return evaluateTreeInternal(nodeId);
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

    if (rules.length === 0) {
      return {
        blockedByRuleIds: [],
        isBlocked: false,
      };
    }

    // Load all conditions for this rule set (required for synchronous evaluation)
    const allConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    const conditionsMap = new Map(allConditions.map((c) => [c._id, c]));

    // Build preloaded data for condition evaluation
    const practitioners = await ctx.db
      .query("practitioners")
      .withIndex("by_practiceId", (q) =>
        q.eq("practiceId", args.context.practiceId),
      )
      .collect();

    // Extract date from ISO ZonedDateTime string
    const dateStr = Temporal.ZonedDateTime.from(args.context.dateTime)
      .toPlainDate()
      .toString();
    const preloadedData = await buildPreloadedDayData(
      ctx.db,
      args.context.practiceId,
      dateStr,
      practitioners,
    );

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
        throw new Error(
          `Root rule node should have exactly 1 child, has ${rootChildren.length}: ${rule._id}. ` +
            `This indicates data corruption in rule structure.`,
        );
      }

      const rootChild = rootChildren[0];
      if (!rootChild) {
        continue;
      }

      // Evaluate the condition tree (synchronously with pre-loaded data)
      const isBlocked = evaluateConditionTree(
        rootChild._id,
        args.context,
        preloadedData,
        conditionsMap,
        allConditions,
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

    // Build condition tree recursively
    const buildConditionTree = async (
      nodeId: Id<"ruleConditions">,
    ): Promise<ConditionTreeNode | null> => {
      const node = await ctx.db.get(nodeId);
      if (!node) {
        return null;
      }

      if (node.nodeType === "CONDITION") {
        // Leaf condition
        if (!node.conditionType || !node.operator) {
          return null;
        }
        return {
          conditionType: node.conditionType,
          nodeType: "CONDITION",
          operator: node.operator,
          ...(node.scope && { scope: node.scope }),
          ...(node.valueIds && { valueIds: node.valueIds }),
          ...(node.valueNumber !== undefined && {
            valueNumber: node.valueNumber,
          }),
        };
      } else {
        // Logical operator (AND/OR)
        const children = await ctx.db
          .query("ruleConditions")
          .withIndex("by_parentConditionId_childOrder", (q) =>
            q.eq("parentConditionId", nodeId),
          )
          .collect();

        const childTrees: ConditionTreeNode[] = [];
        for (const child of children) {
          const childTree = await buildConditionTree(child._id);
          if (childTree) {
            childTrees.push(childTree);
          }
        }

        // At this point, nodeType must be either "AND" or "NOT" since we already checked it's not "CONDITION"
        if (!node.nodeType) {
          return null;
        }
        return {
          children: childTrees,
          nodeType: node.nodeType,
        };
      }
    };

    // Get the first child (root of condition tree)
    const rootChildren = await ctx.db
      .query("ruleConditions")
      .withIndex("by_parentConditionId_childOrder", (q) =>
        q.eq("parentConditionId", args.ruleId),
      )
      .collect();

    if (rootChildren.length === 0 || !rootChildren[0]) {
      return {
        description: `Rule ${args.ruleId} - ${rule.enabled ? "Enabled" : "Disabled"}`,
        treeStructure: "",
      };
    }

    // Build the condition tree
    const conditionTree = await buildConditionTree(rootChildren[0]._id);
    if (!conditionTree) {
      return {
        description: `Rule ${args.ruleId} - ${rule.enabled ? "Enabled" : "Disabled"}`,
        treeStructure: "",
      };
    }

    // Convert tree to conditions
    const conditions = conditionTreeToConditions(conditionTree);

    // Fetch all entities needed for name resolution
    const allAppointmentTypes = await ctx.db
      .query("appointmentTypes")
      .collect();
    const allPractitioners = await ctx.db.query("practitioners").collect();
    const allLocations = await ctx.db.query("locations").collect();

    // Generate natural language description
    const naturalLanguageDescription = generateRuleName(
      conditions,
      allAppointmentTypes.map((at) => ({ _id: at._id, name: at.name })),
      allPractitioners.map((p) => ({ _id: p._id, name: p.name })),
      allLocations.map((l) => ({ _id: l._id, name: l.name })),
    );

    return {
      description: `Rule ${args.ruleId} - ${rule.enabled ? "Enabled" : "Disabled"}`,
      treeStructure: naturalLanguageDescription,
    };
  },
  returns: v.object({
    description: v.string(),
    treeStructure: v.string(),
  }),
});

/**
 * Scope validator for conditions that operate at different levels.
 */
export const scopeValidator = v.union(
  v.literal("practice"),
  v.literal("location"),
  v.literal("practitioner"),
);

/**
 * Type for scope (practice, location, or practitioner level).
 */
export type Scope = "location" | "practice" | "practitioner";

/**
 * Condition types supported by the rule engine.
 */
export type ConditionType =
  | "APPOINTMENT_TYPE"
  | "CLIENT_TYPE"
  | "CONCURRENT_COUNT"
  | "DAILY_CAPACITY"
  | "DATE_RANGE"
  | "DAY_OF_WEEK"
  | "DAYS_AHEAD"
  | "LOCATION"
  | "PRACTITIONER"
  | "PRACTITIONER_TAG"
  | "TIME_RANGE";

/**
 * Operators supported by conditions.
 */
export type ConditionOperator =
  | "EQUALS"
  | "GREATER_THAN_OR_EQUAL"
  | "IS"
  | "IS_NOT"
  | "LESS_THAN_OR_EQUAL";

/**
 * A logical node (AND/NOT) that contains child nodes.
 */
export interface LogicalNode {
  children: ConditionTreeNode[];
  nodeType: "AND" | "NOT";
}

/**
 * A leaf condition node with actual condition data.
 */
export interface ConditionNode {
  conditionType: ConditionType;
  nodeType: "CONDITION";
  operator: ConditionOperator;
  scope?: Scope;
  valueIds?: string[];
  valueNumber?: number;
}

/**
 * A node in the condition tree - either a logical operator or a leaf condition.
 * This is a properly typed recursive type (not using Infer to avoid `any` in children).
 */
export type ConditionTreeNode = ConditionNode | LogicalNode;

/**
 * Validator for condition tree nodes used in rule creation/updates.
 *
 * Note: Convex validators don't support recursive types, so we use v.any() for children.
 * The actual type safety comes from the ConditionTreeNode type above, which is properly
 * recursive. Runtime validation is done via validateConditionTree().
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
    scope: v.optional(scopeValidator),
    valueIds: v.optional(v.array(v.string())),
    valueNumber: v.optional(v.number()),
  }),
);

/**
 * Type guard to check if a node is a logical operator node (AND/NOT).
 */
export function isLogicalNode(node: ConditionTreeNode): node is LogicalNode {
  return node.nodeType === "AND" || node.nodeType === "NOT";
}

/**
 * Type guard to check if a node is a condition leaf node.
 */
export function isConditionNode(
  node: ConditionTreeNode,
): node is ConditionNode {
  return node.nodeType === "CONDITION";
}

/**
 * Type guard to check if unknown value is a valid condition tree node.
 * Use this to safely cast children from the validator's `any[]` to ConditionTreeNode.
 */
export function isValidNode(value: unknown): value is ConditionTreeNode {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("nodeType" in value)) {
    return false;
  }
  const nodeType = (value as { nodeType: unknown }).nodeType;
  // Check for logical nodes
  if (nodeType === "AND" || nodeType === "NOT") {
    return (
      "children" in value &&
      Array.isArray((value as { children: unknown }).children)
    );
  }
  // Check for condition nodes
  if (nodeType === "CONDITION") {
    return "conditionType" in value && "operator" in value;
  }
  return false;
}

/**
 * Safely get typed children from a logical node.
 * Validates each child and throws if any are invalid.
 */
export function getTypedChildren(node: LogicalNode): ConditionTreeNode[] {
  return node.children.map((child: unknown, index: number) => {
    if (!isValidNode(child)) {
      throw new Error(`Invalid child at index ${index}`);
    }
    return child;
  });
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

/**
 * Helper to recursively determine if a rule tree is day-invariant.
 * A tree is day-invariant if ALL leaf conditions are day-invariant.
 */
function isRuleTreeDayInvariant(
  nodeId: Id<"ruleConditions">,
  conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>,
  allConditions: Doc<"ruleConditions">[],
): boolean {
  const node = conditionsMap.get(nodeId);
  if (!node) {
    throw new Error(
      `Condition node not found during classification: ${nodeId}. ` +
        `This indicates data corruption in rule conditions.`,
    );
  }

  // If this is a leaf condition, check if it's day-invariant
  if (node.nodeType === "CONDITION") {
    return node.conditionType
      ? DAY_INVARIANT_CONDITION_TYPES.has(node.conditionType)
      : false;
  }

  // For AND/NOT nodes, check all children recursively
  const children = allConditions
    .filter((c) => c.parentConditionId === nodeId)
    .toSorted((a, b) => a.childOrder - b.childOrder);

  if (children.length === 0) {
    return false;
  }

  // A tree is day-invariant only if ALL children are day-invariant
  return children.every((child) =>
    isRuleTreeDayInvariant(child._id, conditionsMap, allConditions),
  );
}

/**
 * Helper to recursively determine if a rule tree is independent of appointment type.
 * A tree is appointment-type-independent if it contains NO APPOINTMENT_TYPE conditions.
 */
function isRuleTreeAppointmentTypeIndependent(
  nodeId: Id<"ruleConditions">,
  conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>,
  allConditions: Doc<"ruleConditions">[],
): boolean {
  const node = conditionsMap.get(nodeId);
  if (!node) {
    throw new Error(
      `Condition node not found during classification: ${nodeId}. ` +
        `This indicates data corruption in rule conditions.`,
    );
  }

  // If this is a leaf condition, check if it's NOT appointment type
  if (node.nodeType === "CONDITION") {
    return node.conditionType !== "APPOINTMENT_TYPE";
  }

  // For AND/NOT nodes, check all children recursively
  const children = allConditions
    .filter((c) => c.parentConditionId === nodeId)
    .toSorted((a, b) => a.childOrder - b.childOrder);

  if (children.length === 0) {
    return true; // Empty tree doesn't depend on appointment type
  }

  // A tree is appointment-type-independent only if ALL children are
  return children.every((child) =>
    isRuleTreeAppointmentTypeIndependent(
      child._id,
      conditionsMap,
      allConditions,
    ),
  );
}

/**
 * PERFORMANCE OPTIMIZATION: Load all rules and their condition trees for a rule set once.
 * This allows us to evaluate many appointments against the same rules without reloading them each time.
 *
 * Returns a structured object containing all rules and all their conditions pre-loaded.
 */
export const loadRulesForRuleSet = internalQuery({
  args: {
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

    // Load all conditions for all rules in a single pass
    // This is much more efficient than loading them recursively for each slot
    const allConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    // Build a map for quick lookup
    const conditionsMap = new Map<
      Id<"ruleConditions">,
      Doc<"ruleConditions">
    >();
    for (const condition of allConditions) {
      conditionsMap.set(condition._id, condition);
    }

    // Classify each rule as day-invariant or time-variant
    const classifiedRules = rules.map((r) => {
      const rootChildren = allConditions.filter(
        (c) => c.parentConditionId === r._id,
      );
      const firstChild = rootChildren[0];
      const isDayInvariant =
        rootChildren.length === 1 &&
        firstChild !== undefined &&
        isRuleTreeDayInvariant(firstChild._id, conditionsMap, allConditions);

      return {
        _id: r._id,
        isDayInvariant,
      };
    });

    return {
      conditions: allConditions,
      conditionsMap: Object.fromEntries(conditionsMap),
      dayInvariantCount: classifiedRules.filter((r) => r.isDayInvariant).length,
      rules: classifiedRules,
      timeVariantCount: classifiedRules.filter((r) => !r.isDayInvariant).length,
      totalConditions: allConditions.length,
    };
  },
  returns: v.object({
    conditions: v.array(v.any()),
    conditionsMap: v.any(),
    dayInvariantCount: v.number(),
    rules: v.array(
      v.object({
        _id: v.id("ruleConditions"),
        isDayInvariant: v.boolean(),
      }),
    ),
    timeVariantCount: v.number(),
    totalConditions: v.number(),
  }),
});

/**
 * Load rules that are independent of appointment type.
 * These rules can be evaluated and displayed even before a user selects an appointment type.
 */
export const loadAppointmentTypeIndependentRules = internalQuery({
  args: {
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

    // Load all conditions
    const allConditions = await ctx.db
      .query("ruleConditions")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();

    // Build a map for quick lookup
    const conditionsMap = new Map<
      Id<"ruleConditions">,
      Doc<"ruleConditions">
    >();
    for (const condition of allConditions) {
      conditionsMap.set(condition._id, condition);
    }

    // Filter rules that are appointment-type-independent
    const appointmentTypeIndependentRules = rules.filter((r) => {
      const rootChildren = allConditions.filter(
        (c) => c.parentConditionId === r._id,
      );
      const firstChild = rootChildren[0];
      return (
        rootChildren.length === 1 &&
        firstChild !== undefined &&
        isRuleTreeAppointmentTypeIndependent(
          firstChild._id,
          conditionsMap,
          allConditions,
        )
      );
    });

    // Only return conditions that are part of appointment-type-independent rules
    const relevantConditionIds = new Set<Id<"ruleConditions">>();
    const addConditionAndChildren = (conditionId: Id<"ruleConditions">) => {
      relevantConditionIds.add(conditionId);
      const children = allConditions.filter(
        (c) => c.parentConditionId === conditionId,
      );
      for (const child of children) {
        addConditionAndChildren(child._id);
      }
    };

    for (const rule of appointmentTypeIndependentRules) {
      addConditionAndChildren(rule._id);
    }

    const relevantConditions = allConditions.filter((c) =>
      relevantConditionIds.has(c._id),
    );

    // Build filtered conditions map
    const filteredConditionsMap = new Map<
      Id<"ruleConditions">,
      Doc<"ruleConditions">
    >();
    for (const condition of relevantConditions) {
      filteredConditionsMap.set(condition._id, condition);
    }

    return {
      conditions: relevantConditions,
      conditionsMap: Object.fromEntries(filteredConditionsMap),
      rules: appointmentTypeIndependentRules.map((r) => ({
        _id: r._id,
        isDayInvariant: false, // Not used in this context
      })),
    };
  },
  returns: v.object({
    conditions: v.array(v.any()),
    conditionsMap: v.any(),
    rules: v.array(
      v.object({
        _id: v.id("ruleConditions"),
        isDayInvariant: v.boolean(),
      }),
    ),
  }),
});

/**
 * PERFORMANCE OPTIMIZATION: Pre-evaluate day-invariant rules once per query execution.
 * This avoids re-evaluating rules that don't depend on time-of-day for each slot.
 * Plain TypeScript function to avoid serialization overhead.
 *
 * Note: Day-invariant rules only use conditions that don't require appointment data
 * (APPOINTMENT_TYPE, CLIENT_TYPE, DATE_RANGE, DAY_OF_WEEK, DAYS_AHEAD, LOCATION),
 * so we pass an empty preloaded data object.
 */
export function preEvaluateDayInvariantRulesHelper(
  context: AppointmentContext,
  rulesData: {
    conditions: Doc<"ruleConditions">[];
    conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>;
    dayInvariantCount: number;
    rules: { _id: Id<"ruleConditions">; isDayInvariant: boolean }[];
  },
  practitioners: Map<Id<"practitioners">, Doc<"practitioners">>,
): {
  blockedByRuleIds: Id<"ruleConditions">[];
  evaluatedCount: number;
} {
  const blockedRuleIds: Id<"ruleConditions">[] = [];

  // Day-invariant rules don't use DAILY_CAPACITY, CONCURRENT_COUNT, or PRACTITIONER_TAG,
  // so we create an empty preloaded data object (practitioners passed for completeness)
  const emptyPreloadedData: PreloadedDayData = {
    appointments: [],
    appointmentsByStartTime: new Map(),
    dailyCapacityCounts: new Map(),
    practitioners,
  };

  // Helper to get condition from the pre-loaded map
  const getCondition = (
    nodeId: Id<"ruleConditions">,
  ): Doc<"ruleConditions"> | undefined => {
    return rulesData.conditionsMap.get(nodeId);
  };

  // Helper to get children of a condition from the pre-loaded conditions
  const getChildren = (
    parentId: Id<"ruleConditions">,
  ): Doc<"ruleConditions">[] => {
    const filtered = rulesData.conditions.filter(
      (c) => c.parentConditionId === parentId,
    );
    return filtered.toSorted((a, b) => a.childOrder - b.childOrder);
  };

  // Recursive function to evaluate condition tree using pre-loaded data
  const evaluateTreeFromLoaded = (nodeId: Id<"ruleConditions">): boolean => {
    const node = getCondition(nodeId);
    if (!node) {
      throw new Error(`Condition node not found: ${nodeId}`);
    }

    // If this is a leaf condition, evaluate it directly
    if (node.nodeType === "CONDITION") {
      return evaluateCondition(node, context, emptyPreloadedData);
    }

    // Get ordered children
    const children = getChildren(nodeId);

    if (children.length === 0) {
      throw new Error(`Logical operator node has no children: ${nodeId}`);
    }

    // Evaluate based on node type
    switch (node.nodeType) {
      case "AND": {
        // All children must be true
        for (const child of children) {
          const result = evaluateTreeFromLoaded(child._id);
          if (!result) {
            return false; // Short-circuit
          }
        }
        return true;
      }

      case "NOT": {
        // Invert the result of the single child
        if (children.length !== 1) {
          throw new Error(`NOT node should have exactly 1 child: ${nodeId}`);
        }
        const child = children[0];
        if (!child) {
          return false;
        }
        const result = evaluateTreeFromLoaded(child._id);
        return !result;
      }

      default: {
        throw new Error(`Unknown node type: ${node.nodeType}`);
      }
    }
  };

  // Evaluate only day-invariant rules
  for (const rule of rulesData.rules) {
    if (!rule.isDayInvariant) {
      continue; // Skip time-variant rules
    }

    const rootChildren = getChildren(rule._id);

    if (rootChildren.length === 0) {
      continue; // Empty rule
    }

    if (rootChildren.length !== 1) {
      throw new Error(
        `Root rule node should have exactly 1 child: ${rule._id}`,
      );
    }

    const firstChild = rootChildren[0];
    if (!firstChild) {
      continue;
    }

    try {
      const isBlocked = evaluateTreeFromLoaded(firstChild._id);
      if (isBlocked) {
        blockedRuleIds.push(rule._id);
      }
    } catch (error) {
      console.error(`Error evaluating day-invariant rule ${rule._id}:`, error);
      throw error;
    }
  }

  return {
    blockedByRuleIds: blockedRuleIds,
    evaluatedCount: rulesData.dayInvariantCount,
  };
}

/**
 * PERFORMANCE OPTIMIZATION: Evaluate pre-loaded rules against an appointment context.
 * Uses the rules and conditions loaded by loadRulesForRuleSet to avoid redundant database queries.
 * This version also accepts pre-evaluated day-invariant rule results to skip redundant checks.
 * Plain TypeScript function to avoid serialization overhead.
 */
export function evaluateLoadedRulesHelper(
  context: AppointmentContext,
  rulesData: {
    conditions: Doc<"ruleConditions">[];
    conditionsMap: Map<Id<"ruleConditions">, Doc<"ruleConditions">>;
    rules: { _id: Id<"ruleConditions">; isDayInvariant: boolean }[];
  },
  preloadedData: PreloadedDayData,
  preEvaluatedDayRules?: {
    blockedByRuleIds: Id<"ruleConditions">[];
    evaluatedCount: number;
  },
): {
  blockedByRuleIds: Id<"ruleConditions">[];
  dayInvariantSkipped: number;
  isBlocked: boolean;
  timeVariantEvaluated: number;
} {
  const blockedByRuleIds: Id<"ruleConditions">[] = [];

  // Start with pre-evaluated day-invariant rules if provided
  if (preEvaluatedDayRules) {
    blockedByRuleIds.push(...preEvaluatedDayRules.blockedByRuleIds);
  }

  // Helper to get condition from the pre-loaded map
  const getCondition = (
    nodeId: Id<"ruleConditions">,
  ): Doc<"ruleConditions"> | undefined => {
    return rulesData.conditionsMap.get(nodeId);
  };

  // Helper to get children of a condition from the pre-loaded conditions
  const getChildren = (
    parentId: Id<"ruleConditions">,
  ): Doc<"ruleConditions">[] => {
    const filtered = rulesData.conditions.filter(
      (c) => c.parentConditionId === parentId,
    );
    return filtered.toSorted((a, b) => a.childOrder - b.childOrder);
  };

  // Recursive function to evaluate condition tree using pre-loaded data
  const evaluateTreeFromLoaded = (nodeId: Id<"ruleConditions">): boolean => {
    const node = getCondition(nodeId);
    if (!node) {
      throw new Error(
        `Condition node not found: ${nodeId}. ` +
          `This indicates data corruption - referenced node does not exist.`,
      );
    }

    // If this is a leaf condition, evaluate it directly
    if (node.nodeType === "CONDITION") {
      return evaluateCondition(node, context, preloadedData);
    }

    // Get ordered children
    const children = getChildren(nodeId);

    if (children.length === 0) {
      throw new Error(
        `Logical operator node has no children: ${nodeId}. ` +
          `This indicates data corruption - AND/NOT nodes must have children.`,
      );
    }

    // Evaluate based on node type
    switch (node.nodeType) {
      case "AND": {
        // All children must be true
        for (const child of children) {
          const result = evaluateTreeFromLoaded(child._id);
          if (!result) {
            return false; // Short-circuit: if any child is false, return false
          }
        }
        return true;
      }

      case "NOT": {
        // Invert the result of the single child
        if (children.length !== 1) {
          throw new Error(
            `NOT node should have exactly 1 child, has ${children.length}: ${nodeId}. ` +
              `This indicates data corruption.`,
          );
        }
        const child = children[0];
        if (!child) {
          return false;
        }
        const result = evaluateTreeFromLoaded(child._id);
        return !result;
      }

      default: {
        throw new Error(
          `Unknown node type: ${node.nodeType}. ` +
            `This indicates data corruption in rule condition tree.`,
        );
      }
    }
  };

  // Evaluate only time-variant rules (day-invariant rules were pre-evaluated)
  let timeVariantEvaluated = 0;
  for (const rule of rulesData.rules) {
    // Skip day-invariant rules if they were pre-evaluated
    if (rule.isDayInvariant && preEvaluatedDayRules) {
      continue;
    }

    // Get the first child of the root node (the actual condition tree)
    const rootChildren = getChildren(rule._id);

    timeVariantEvaluated++;

    if (rootChildren.length === 0) {
      // Empty rule - skip
      continue;
    }

    // A root node should have exactly one child (the top of the condition tree)
    if (rootChildren.length !== 1) {
      throw new Error(
        `Root rule node should have exactly 1 child, has ${rootChildren.length}: ${rule._id}. ` +
          `This indicates data corruption in rule structure.`,
      );
    }

    const rootChild = rootChildren[0];
    if (!rootChild) {
      continue;
    }

    // Evaluate the condition tree using pre-loaded data
    const isBlocked = evaluateTreeFromLoaded(rootChild._id);

    if (isBlocked) {
      blockedByRuleIds.push(rule._id);
      // EARLY TERMINATION: Stop evaluating once we find a blocking rule
      // No need to check remaining rules since we already know the slot is blocked
      break;
    }
  }

  return {
    blockedByRuleIds,
    dayInvariantSkipped: preEvaluatedDayRules?.evaluatedCount ?? 0,
    isBlocked: blockedByRuleIds.length > 0,
    timeVariantEvaluated,
  };
}
