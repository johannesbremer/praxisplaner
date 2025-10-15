import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

// ================================
// LAMBDA CALCULUS RULE ENGINE TYPES
// ================================

/**
 * Base condition types for the rule engine
 */
export type ConditionTree =
  | PropertyCondition
  | CountCondition
  | TimeRangeFreeCondition
  | AdjacentCondition
  | AndCondition
  | OrCondition
  | NotCondition;

/**
 * Property: Check a slot or context attribute
 */
export interface PropertyCondition {
  type: "Property";
  entity: "Slot" | "Context";
  attr: string;
  op: "=" | "!=" | "<" | ">" | "<=" | ">=" | "IN" | "NOT_IN";
  value: string | number | ReadonlyArray<string>;
}

/**
 * Count: Count appointments matching criteria
 */
export interface CountCondition {
  type: "Count";
  entity: "Appointment";
  filter: {
    overlaps?: boolean;
    type?: string;
    location?: string;
    doctor?: string;
    // Extensible for any appointment attribute
    [key: string]: boolean | string | undefined;
  };
  op: "=" | "!=" | "<" | ">" | "<=" | ">=";
  value: number;
}

/**
 * TimeRangeFree: Check if a time range has no appointments
 */
export interface TimeRangeFreeCondition {
  type: "TimeRangeFree";
  start: "Slot.start" | "Slot.end";
  duration: string; // e.g. "35min", "2h"
}

/**
 * Adjacent: Check if an appointment exists immediately before/after
 */
export interface AdjacentCondition {
  type: "Adjacent";
  entity: "Appointment";
  filter: {
    type?: string;
    doctor?: string;
    // Extensible for any appointment attribute
    [key: string]: string | undefined;
  };
  direction: "before" | "after";
}

/**
 * AND: All children must be true
 */
export interface AndCondition {
  type: "AND";
  children: ReadonlyArray<ConditionTree>;
}

/**
 * OR: At least one child must be true
 */
export interface OrCondition {
  type: "OR";
  children: ReadonlyArray<ConditionTree>;
}

/**
 * NOT: Inverts the child
 */
export interface NotCondition {
  type: "NOT";
  child: ConditionTree;
}

/**
 * Zones that can be created when a rule allows booking
 */
export interface RuleZones {
  createZone?: {
    condition: ConditionTree; // When to create zone
    zone: {
      start: "Slot.end" | "Slot.start";
      duration: string;
      allowOnly: ReadonlyArray<string>; // Appointment types
    };
  };
}

/**
 * Complete rule structure
 */
export interface SchedulingRule {
  _id?: Id<"rules">;
  ruleSetId: Id<"ruleSets">;
  name: string;
  description?: string;
  priority: number; // Lower number = higher priority
  condition: ConditionTree;
  action: "BLOCK" | "ALLOW";
  zones?: RuleZones;
  message: string;
  enabled: boolean;
}

/**
 * Slot context for rule evaluation
 */
export interface SlotContext {
  start: string; // ISO datetime
  end: string; // ISO datetime
  type: string; // Appointment type
  doctor?: string; // Practitioner ID
  location?: string; // Location ID
  duration: number; // Minutes
  [key: string]: string | number | undefined;
}

/**
 * Appointment for rule evaluation
 */
export interface AppointmentContext {
  _id: Id<"appointments">;
  start: string; // ISO datetime
  end: string; // ISO datetime
  type?: string;
  doctor?: string;
  location?: string;
  [key: string]: string | Id<"appointments"> | undefined;
}

/**
 * Global context for rule evaluation
 */
export interface EvaluationContext {
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
  [key: string]: string | Id<"practices"> | Id<"ruleSets"> | undefined;
}

/**
 * Rule evaluation result
 */
export interface RuleEvaluationResult {
  action: "BLOCK" | "ALLOW";
  ruleId?: Id<"rules"> | undefined;
  ruleName?: string | undefined;
  message?: string | undefined;
  zones?: RuleZones | undefined;
}

// ================================
// CONVEX VALIDATORS
// ================================

/**
 * Validator for property conditions
 */
export const propertyConditionValidator = v.object({
  type: v.literal("Property"),
  entity: v.union(v.literal("Slot"), v.literal("Context")),
  attr: v.string(),
  op: v.union(
    v.literal("="),
    v.literal("!="),
    v.literal("<"),
    v.literal(">"),
    v.literal("<="),
    v.literal(">="),
    v.literal("IN"),
    v.literal("NOT_IN"),
  ),
  value: v.union(v.string(), v.number(), v.array(v.string())),
});

/**
 * Validator for count conditions
 */
export const countConditionValidator = v.object({
  type: v.literal("Count"),
  entity: v.literal("Appointment"),
  filter: v.any(), // Dynamic object with optional properties
  op: v.union(
    v.literal("="),
    v.literal("!="),
    v.literal("<"),
    v.literal(">"),
    v.literal("<="),
    v.literal(">="),
  ),
  value: v.number(),
});

/**
 * Validator for time range free conditions
 */
export const timeRangeFreeConditionValidator = v.object({
  type: v.literal("TimeRangeFree"),
  start: v.union(v.literal("Slot.start"), v.literal("Slot.end")),
  duration: v.string(),
});

/**
 * Validator for adjacent conditions
 */
export const adjacentConditionValidator = v.object({
  type: v.literal("Adjacent"),
  entity: v.literal("Appointment"),
  filter: v.any(), // Dynamic object with optional properties
  direction: v.union(v.literal("before"), v.literal("after")),
});

/**
 * Validator for condition trees (recursive)
 * Note: We use v.any() for recursive structures and validate at runtime
 */
export const conditionTreeValidator = v.any();

/**
 * Validator for side effects
 */
export const sideEffectsValidator = v.object({
  createZone: v.optional(
    v.object({
      condition: conditionTreeValidator,
      zone: v.object({
        start: v.union(v.literal("Slot.end"), v.literal("Slot.start")),
        duration: v.string(),
        allowOnly: v.array(v.string()),
      }),
    }),
  ),
});

/**
 * Validator for complete scheduling rule
 */
export const schedulingRuleValidator = v.object({
  ruleSetId: v.id("ruleSets"),
  name: v.string(),
  description: v.optional(v.string()),
  priority: v.number(),
  condition: conditionTreeValidator,
  action: v.union(v.literal("BLOCK"), v.literal("ALLOW")),
  sideEffects: v.optional(sideEffectsValidator),
  message: v.string(),
  enabled: v.boolean(),
});
