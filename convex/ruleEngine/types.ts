import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";

// ================================
// LAMBDA CALCULUS RULE ENGINE TYPES
// ================================

/**
 * Base condition types for the rule engine
 */
export type ConditionTree =
  | AdjacentCondition
  | AndCondition
  | CountCondition
  | NotCondition
  | OrCondition
  | PropertyCondition
  | TimeRangeFreeCondition;

/**
 * Property: Check a slot or context attribute
 */
export interface PropertyCondition {
  attr: string;
  entity: "Context" | "Slot";
  op: "!=" | "<" | "<=" | "=" | ">" | ">=" | "IN" | "NOT_IN";
  type: "Property";
  value: number | readonly string[] | string;
  // Optional time-of-day scoping (HH:MM format)
  end?: string; // Exclusive upper bound
  start?: string; // Inclusive lower bound
}

/**
 * Count: Count appointments matching criteria
 */
export interface CountCondition {
  entity: "Appointment";
  filter: {
    doctor?: Id<"practitioners">; // Practitioner ID (not name)
    location?: Id<"locations">; // Location ID (not name)
    overlaps?: boolean;
    type?: Id<"appointmentTypes">; // Appointment type ID (not name)
    // Extensible for any appointment attribute
    [key: string]:
      | boolean
      | Id<"appointmentTypes">
      | Id<"locations">
      | Id<"practitioners">
      | undefined;
  };
  op: "!=" | "<" | "<=" | "=" | ">" | ">=";
  type: "Count";
  value: number;
  // Optional time-of-day scoping (HH:MM format)
  end?: string; // Exclusive upper bound
  start?: string; // Inclusive lower bound
}

/**
 * TimeRangeFree: Check if a time range has no appointments
 */
export interface TimeRangeFreeCondition {
  duration: string; // e.g. "35min", "2h"
  start: "Slot.end" | "Slot.start";
  type: "TimeRangeFree";
  // Optional time-of-day scoping (HH:MM format)
  end?: string; // Exclusive upper bound
  timeOfDayStart?: string; // Inclusive lower bound (renamed to avoid conflict with 'start')
}

/**
 * Adjacent: Check if an appointment exists immediately before/after
 */
export interface AdjacentCondition {
  direction: "after" | "before";
  entity: "Appointment";
  filter: {
    doctor?: Id<"practitioners">; // Practitioner ID (not name)
    location?: Id<"locations">; // Location ID (not name)
    type?: Id<"appointmentTypes">; // Appointment type ID (not name)
    // Extensible for any appointment attribute
    [key: string]:
      | Id<"appointmentTypes">
      | Id<"locations">
      | Id<"practitioners">
      | undefined;
  };
  type: "Adjacent";
  // Optional time-of-day scoping (HH:MM format)
  end?: string; // Exclusive upper bound
  start?: string; // Inclusive lower bound
}

/**
 * AND: All children must be true
 */
export interface AndCondition {
  children: readonly ConditionTree[];
  type: "AND";
}

/**
 * OR: At least one child must be true
 */
export interface OrCondition {
  children: readonly ConditionTree[];
  type: "OR";
}

/**
 * NOT: Inverts the child
 */
export interface NotCondition {
  child: ConditionTree;
  type: "NOT";
}

/**
 * Zones that can be created when a rule allows booking
 */
export interface RuleZones {
  createZone?: {
    condition: ConditionTree; // When to create zone
    zone: {
      allowOnly: readonly Id<"appointmentTypes">[]; // Appointment type IDs (not names)
      duration: string;
      start: "Slot.end" | "Slot.start";
    };
  };
}

/**
 * Complete rule structure
 */
export interface SchedulingRule {
  _id?: Id<"rules">;
  action: "ALLOW" | "BLOCK";
  condition: ConditionTree;
  description?: string;
  enabled: boolean;
  message: string;
  name: string;
  priority: number; // Lower number = higher priority
  ruleSetId: Id<"ruleSets">;
  zones?: RuleZones;
}

/**
 * Slot context for rule evaluation
 */
export interface SlotContext {
  [key: string]:
    | Id<"appointmentTypes">
    | Id<"locations">
    | Id<"practitioners">
    | number
    | string
    | undefined;
  doctor?: Id<"practitioners">; // Practitioner ID
  duration: number; // Minutes
  end: string; // ISO datetime
  location?: Id<"locations">; // Location ID
  start: string; // ISO datetime
  type: Id<"appointmentTypes">; // Appointment type ID
}

/**
 * Appointment for rule evaluation
 */
export interface AppointmentContext {
  [key: string]:
    | Id<"appointments">
    | Id<"appointmentTypes">
    | Id<"locations">
    | Id<"practitioners">
    | string
    | undefined;
  _id: Id<"appointments">;
  doctor?: Id<"practitioners">; // Practitioner ID
  end: string; // ISO datetime
  location?: Id<"locations">; // Location ID
  start: string; // ISO datetime
  type?: Id<"appointmentTypes">; // Appointment type ID
}

/**
 * Global context for rule evaluation
 */
export interface EvaluationContext {
  [key: string]: Id<"practices"> | Id<"ruleSets"> | string | undefined;
  practiceId: Id<"practices">;
  ruleSetId: Id<"ruleSets">;
}

/**
 * Result returned after evaluating rules for a slot, containing the action (ALLOW/BLOCK) and optional metadata.
 */
export interface RuleEvaluationResult {
  action: "ALLOW" | "BLOCK";
  message?: string | undefined;
  ruleId?: Id<"rules"> | undefined;
  ruleName?: string | undefined;
  zones?: RuleZones | undefined;
}

// ================================
// CONVEX VALIDATORS
// ================================

/**
 * Validator for property conditions
 */
export const propertyConditionValidator = v.object({
  attr: v.string(),
  end: v.optional(v.string()),
  entity: v.union(v.literal("Slot"), v.literal("Context")),
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
  start: v.optional(v.string()),
  type: v.literal("Property"),
  value: v.union(
    v.string(),
    v.number(),
    v.array(v.string()),
    v.id("practitioners"),
    v.id("appointmentTypes"),
    v.id("locations"),
    v.array(v.id("practitioners")),
    v.array(v.id("appointmentTypes")),
    v.array(v.id("locations")),
  ),
});

/**
 * Validator for count conditions
 */
export const countConditionValidator = v.object({
  end: v.optional(v.string()),
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
  start: v.optional(v.string()),
  type: v.literal("Count"),
  value: v.number(),
});

/**
 * Validator for time range free conditions
 */
export const timeRangeFreeConditionValidator = v.object({
  duration: v.string(),
  end: v.optional(v.string()),
  start: v.union(v.literal("Slot.start"), v.literal("Slot.end")),
  timeOfDayStart: v.optional(v.string()),
  type: v.literal("TimeRangeFree"),
});

/**
 * Validator for adjacent conditions
 */
export const adjacentConditionValidator = v.object({
  direction: v.union(v.literal("before"), v.literal("after")),
  end: v.optional(v.string()),
  entity: v.literal("Appointment"),
  filter: v.any(), // Dynamic object with optional properties
  start: v.optional(v.string()),
  type: v.literal("Adjacent"),
});

/**
 * Validator for condition trees (recursive)
 * Note: We use v.any() for recursive structures and validate at runtime
 */
export const conditionTreeValidator = v.any();

/**
 * Validator for side effects
 */
export const zonesValidator = v.object({
  createZone: v.optional(
    v.object({
      condition: conditionTreeValidator,
      zone: v.object({
        allowOnly: v.array(v.id("appointmentTypes")), // Appointment type IDs
        duration: v.string(),
        start: v.union(v.literal("Slot.end"), v.literal("Slot.start")),
      }),
    }),
  ),
});

/**
 * Validator for complete scheduling rule
 */
export const schedulingRuleValidator = v.object({
  action: v.union(v.literal("BLOCK"), v.literal("ALLOW")),
  condition: conditionTreeValidator,
  description: v.optional(v.string()),
  enabled: v.boolean(),
  message: v.string(),
  name: v.string(),
  priority: v.number(),
  ruleSetId: v.id("ruleSets"),
  zones: v.optional(zonesValidator),
});
