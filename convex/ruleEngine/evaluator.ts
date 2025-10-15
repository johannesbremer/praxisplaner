import type { Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import type {
  AdjacentCondition,
  AppointmentContext,
  ConditionTree,
  CountCondition,
  EvaluationContext,
  PropertyCondition,
  RuleEvaluationResult,
  SchedulingRule,
  SlotContext,
  TimeRangeFreeCondition,
} from "./types";

import {
  InvalidConditionTypeError,
  InvalidDurationError,
  InvalidOperatorError,
  TypeMismatchError,
} from "./errors";

// ================================
// DURATION PARSING
// ================================

/**
 * Parse duration string to milliseconds.
 * Supports: "35min", "2h", "1h30min".
 */
export function parseDuration(duration: string): number {
  const parts = duration.match(/\d+(?:h|min)/g);
  if (!parts) {
    throw new InvalidDurationError(duration, ["35min", "2h", "1h30min"]);
  }

  let totalMs = 0;
  for (const part of parts) {
    if (part.endsWith("h")) {
      const value = Number.parseInt(part.slice(0, -1), 10);
      totalMs += value * 60 * 60 * 1000;
    } else if (part.endsWith("min")) {
      const value = Number.parseInt(part.slice(0, -3), 10);
      totalMs += value * 60 * 1000;
    }
  }

  return totalMs;
}

// ================================
// COMPARISON OPERATORS
// ================================

/**
 * Try to convert a value to a number for comparison.
 * Handles ISO datetime strings, time strings (HH:MM), and plain numbers.
 */
function tryConvertToNumber(value: number | string): null | number {
  // Already a number
  if (typeof value === "number") {
    return value;
  }

  // Try parsing as ISO datetime string
  const isoDate = new Date(value);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate.getTime();
  }

  // Try parsing as time string (HH:MM or HH:MM:SS)
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (timeMatch?.[1] && timeMatch[2]) {
    const hours = Number.parseInt(timeMatch[1], 10);
    const minutes = Number.parseInt(timeMatch[2], 10);
    const seconds = timeMatch[3] ? Number.parseInt(timeMatch[3], 10) : 0;
    // Return minutes since midnight
    return hours * 60 + minutes + seconds / 60;
  }

  // Try parsing as plain number string
  const num = Number(value);
  if (!Number.isNaN(num)) {
    return num;
  }

  return null;
}

/**
 * Compare two values using an operator.
 * Automatically converts datetime/time strings to numbers for numeric comparison.
 */
function compareValues(
  left: number | string,
  op: string,
  right: number | readonly string[] | string,
): boolean {
  const allowedOperators = [
    "=",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
    "IN",
    "NOT_IN",
  ] as const;

  switch (op) {
    case "!=": {
      return left !== right;
    }
    case "<": {
      const leftNum = tryConvertToNumber(left);
      const rightNum =
        typeof right === "string" || typeof right === "number"
          ? tryConvertToNumber(right)
          : null;

      if (leftNum === null || rightNum === null) {
        throw new TypeMismatchError(
          { left, right },
          "number or datetime/time string",
          op,
          "Both operands must be numbers, datetime strings, or time strings for '<' comparison",
        );
      }
      return leftNum < rightNum;
    }
    case "<=": {
      const leftNum = tryConvertToNumber(left);
      const rightNum =
        typeof right === "string" || typeof right === "number"
          ? tryConvertToNumber(right)
          : null;

      if (leftNum === null || rightNum === null) {
        throw new TypeMismatchError(
          { left, right },
          "number or datetime/time string",
          op,
          "Both operands must be numbers, datetime strings, or time strings for '<=' comparison",
        );
      }
      return leftNum <= rightNum;
    }
    case "=": {
      return left === right;
    }
    case ">": {
      const leftNum = tryConvertToNumber(left);
      const rightNum =
        typeof right === "string" || typeof right === "number"
          ? tryConvertToNumber(right)
          : null;

      if (leftNum === null || rightNum === null) {
        throw new TypeMismatchError(
          { left, right },
          "number or datetime/time string",
          op,
          "Both operands must be numbers, datetime strings, or time strings for '>' comparison",
        );
      }
      return leftNum > rightNum;
    }
    case ">=": {
      const leftNum = tryConvertToNumber(left);
      const rightNum =
        typeof right === "string" || typeof right === "number"
          ? tryConvertToNumber(right)
          : null;

      if (leftNum === null || rightNum === null) {
        throw new TypeMismatchError(
          { left, right },
          "number or datetime/time string",
          op,
          "Both operands must be numbers, datetime strings, or time strings for '>=' comparison",
        );
      }
      return leftNum >= rightNum;
    }
    case "IN": {
      if (!Array.isArray(right)) {
        throw new TypeMismatchError(
          right,
          "array",
          op,
          "The IN operator requires an array on the right side",
        );
      }
      return right.includes(String(left));
    }
    case "NOT_IN": {
      if (!Array.isArray(right)) {
        throw new TypeMismatchError(
          right,
          "array",
          op,
          "The NOT_IN operator requires an array on the right side",
        );
      }
      return !right.includes(String(left));
    }
    default: {
      throw new InvalidOperatorError(op, allowedOperators);
    }
  }
}

// ================================
// TIME UTILITIES
// ================================

/**
 * Extract time-of-day as minutes since midnight from ISO datetime string.
 */
function extractTimeOfDay(isoDateTime: string): number {
  const date = new Date(isoDateTime);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Parse time string (HH:MM) to minutes since midnight.
 */
function parseTimeOfDay(timeStr: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  if (!match?.[1] || !match[2]) {
    throw new InvalidDurationError(timeStr, ["11:00", "09:30", "14:15"]);
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new InvalidDurationError(timeStr, ["11:00", "09:30", "14:15"]);
  }

  return hours * 60 + minutes;
}

/**
 * Check if a slot's time-of-day falls within the specified range.
 * @param slotStart ISO datetime string of slot start
 * @param rangeStart Optional HH:MM string (inclusive), undefined means no lower bound
 * @param rangeEnd Optional HH:MM string (exclusive), undefined means no upper bound
 * @returns true if slot time is within range or no range specified
 */
function isWithinTimeOfDayRange(
  slotStart: string,
  rangeStart?: string,
  rangeEnd?: string,
): boolean {
  // No time range specified - always applies
  if (!rangeStart && !rangeEnd) {
    return true;
  }

  const slotTimeOfDay = extractTimeOfDay(slotStart);

  if (rangeStart && rangeEnd) {
    const start = parseTimeOfDay(rangeStart);
    const end = parseTimeOfDay(rangeEnd);

    // Handle ranges that cross midnight (e.g., 22:00 - 02:00)
    if (start > end) {
      return slotTimeOfDay >= start || slotTimeOfDay < end;
    }

    // Normal range (e.g., 11:00 - 12:00)
    return slotTimeOfDay >= start && slotTimeOfDay < end;
  }

  if (rangeStart) {
    const start = parseTimeOfDay(rangeStart);
    return slotTimeOfDay >= start;
  }

  if (rangeEnd) {
    const end = parseTimeOfDay(rangeEnd);
    return slotTimeOfDay < end;
  }

  return true;
}

/**
 * Check if two time ranges overlap.
 */
function timeRangesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string,
): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * Add milliseconds to an ISO datetime string.
 */
function addMilliseconds(isoDate: string, ms: number): string {
  const date = new Date(isoDate);
  date.setTime(date.getTime() + ms);
  return date.toISOString();
}

// ================================
// CONDITION EVALUATION
// ================================

/**
 * Evaluate a Property condition.
 */
function evaluateProperty(
  condition: PropertyCondition,
  slot: SlotContext,
  context: EvaluationContext,
): boolean {
  // Check time-of-day scoping first
  if (!isWithinTimeOfDayRange(slot.start, condition.start, condition.end)) {
    return false; // Outside time range, condition doesn't apply
  }

  const entity = condition.entity === "Slot" ? slot : context;
  const value = entity[condition.attr];

  if (value === undefined) {
    return false;
  }

  try {
    return compareValues(value, condition.op, condition.value);
  } catch (error) {
    if (error instanceof TypeMismatchError) {
      // Re-throw with more context about which property failed
      const expectedType =
        (error.details?.["expectedType"] as string | undefined) || "unknown";

      // Log detailed debugging information
      console.error("🔍 TypeMismatchError details:", {
        conditionValue: condition.value,
        conditionValueType: typeof condition.value,
        entity: condition.entity,
        entityValue: value,
        entityValueType: typeof value,
        expectedType,
        operator: condition.op,
        property: condition.attr,
      });

      throw new TypeMismatchError(
        {
          conditionValue: condition.value,
          entity: condition.entity,
          entityValue: value,
          property: condition.attr,
        },
        expectedType,
        condition.op,
        `Property "${condition.attr}" on ${condition.entity} has type ${typeof value}, but operator "${condition.op}" requires a different type. Expected: ${expectedType}, Got: ${typeof value}`,
      );
    }
    throw error;
  }
}

/**
 * Evaluate a Count condition.
 */
function evaluateCount(
  condition: CountCondition,
  slot: SlotContext,
  appointments: readonly AppointmentContext[],
): boolean {
  // Check time-of-day scoping first
  if (!isWithinTimeOfDayRange(slot.start, condition.start, condition.end)) {
    return false; // Outside time range, condition doesn't apply
  }

  let count = 0;

  for (const appointment of appointments) {
    // Check overlap if required
    if (condition.filter.overlaps) {
      const overlaps = timeRangesOverlap(
        slot.start,
        slot.end,
        appointment.start,
        appointment.end,
      );
      if (!overlaps) {
        continue;
      }
    }

    // Check all filter criteria
    let matches = true;
    for (const [key, value] of Object.entries(condition.filter)) {
      if (key === "overlaps") {
        continue;
      } // Already handled

      if (appointment[key] !== value) {
        matches = false;
        break;
      }
    }

    if (matches) {
      count++;
    }
  }

  return compareValues(count, condition.op, condition.value);
}

/**
 * Evaluate a TimeRangeFree condition.
 */
function evaluateTimeRangeFree(
  _db: DatabaseReader,
  condition: TimeRangeFreeCondition,
  slot: SlotContext,
  appointments: readonly AppointmentContext[],
): boolean {
  // Check time-of-day scoping first
  if (
    !isWithinTimeOfDayRange(slot.start, condition.timeOfDayStart, condition.end)
  ) {
    return false; // Outside time range, condition doesn't apply
  }

  const durationMs = parseDuration(condition.duration);
  const startTime = condition.start === "Slot.start" ? slot.start : slot.end;
  const endTime = addMilliseconds(startTime, durationMs);

  // Check if any appointment overlaps with this time range
  for (const appointment of appointments) {
    if (
      timeRangesOverlap(startTime, endTime, appointment.start, appointment.end)
    ) {
      return false; // Not free
    }
  }

  return true; // Free
}

/**
 * Evaluate an Adjacent condition.
 */
function evaluateAdjacent(
  _db: DatabaseReader,
  condition: AdjacentCondition,
  slot: SlotContext,
  appointments: readonly AppointmentContext[],
): boolean {
  // Check time-of-day scoping first
  if (!isWithinTimeOfDayRange(slot.start, condition.start, condition.end)) {
    return false; // Outside time range, condition doesn't apply
  }

  const targetTime = condition.direction === "before" ? slot.start : slot.end;

  for (const appointment of appointments) {
    // Check if appointment is adjacent
    const isAdjacent =
      condition.direction === "before"
        ? appointment.end === targetTime
        : appointment.start === targetTime;

    if (!isAdjacent) {
      continue;
    }

    // Check filter criteria
    let matches = true;
    for (const [key, value] of Object.entries(condition.filter)) {
      if (appointment[key] !== value) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively evaluate a condition tree.
 */
export async function evaluateCondition(
  db: DatabaseReader,
  condition: ConditionTree,
  slot: SlotContext,
  appointments: readonly AppointmentContext[],
  context: EvaluationContext,
): Promise<boolean> {
  const condType = condition.type;
  const validTypes = [
    "Adjacent",
    "AND",
    "Count",
    "NOT",
    "OR",
    "Property",
    "TimeRangeFree",
  ] as const;

  switch (condType) {
    case "Adjacent": {
      return evaluateAdjacent(db, condition, slot, appointments);
    }

    case "AND": {
      const andCondition = condition;
      for (const child of andCondition.children) {
        const result = await evaluateCondition(
          db,
          child,
          slot,
          appointments,
          context,
        );
        if (!result) {
          return false;
        }
      }
      return true;
    }

    case "Count": {
      return evaluateCount(condition, slot, appointments);
    }

    case "NOT": {
      const notCondition = condition;
      const result = await evaluateCondition(
        db,
        notCondition.child,
        slot,
        appointments,
        context,
      );
      return !result;
    }

    case "OR": {
      const orCondition = condition;
      for (const child of orCondition.children) {
        const result = await evaluateCondition(
          db,
          child,
          slot,
          appointments,
          context,
        );
        if (result) {
          return true;
        }
      }
      return false;
    }

    case "Property": {
      return evaluateProperty(condition, slot, context);
    }

    case "TimeRangeFree": {
      return evaluateTimeRangeFree(db, condition, slot, appointments);
    }

    default: {
      // TypeScript should prevent this, but just in case
      throw new InvalidConditionTypeError(
        (condition as ConditionTree).type,
        validTypes,
      );
    }
  }
}

// ================================
// RULE EVALUATION
// ================================

/**
 * Evaluate all rules for a slot and return the first matching result.
 * Rules are evaluated in priority order (lower number = higher priority).
 */
export async function evaluateRules(
  db: DatabaseReader,
  rules: readonly SchedulingRule[],
  slot: SlotContext,
  appointments: readonly AppointmentContext[],
  context: EvaluationContext,
): Promise<RuleEvaluationResult> {
  // Sort rules by priority
  const sortedRules = [...rules].toSorted((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (!rule.enabled) {
      continue;
    }

    const matches = await evaluateCondition(
      db,
      rule.condition,
      slot,
      appointments,
      context,
    );

    if (matches) {
      // First matching rule wins
      if (rule.action === "BLOCK") {
        return {
          action: "BLOCK",
          message: rule.message,
          ruleId: rule._id,
          ruleName: rule.name,
        };
      } else {
        return {
          action: "ALLOW",
          message: rule.message,
          ruleId: rule._id,
          ruleName: rule.name,
          zones: rule.zones,
        };
      }
    }
  }

  // Default: allow if no rules match
  return {
    action: "ALLOW",
    message: "No matching rules, booking allowed by default",
  };
}

/**
 * Fetch all appointments that might be relevant for rule evaluation.
 * This includes appointments that overlap with or are adjacent to the slot.
 */
export async function fetchRelevantAppointments(
  db: DatabaseReader,
  slot: SlotContext,
  practiceId: Id<"practices">,
  maxLookAheadMs: number = 4 * 60 * 60 * 1000, // 4 hours
): Promise<AppointmentContext[]> {
  // Calculate time range to query
  const slotStartTime = new Date(slot.start).getTime();
  const slotEndTime = new Date(slot.end).getTime();
  const queryStart = new Date(slotStartTime - maxLookAheadMs).toISOString();
  const queryEnd = new Date(slotEndTime + maxLookAheadMs).toISOString();

  // Query appointments in the time range
  const appointments = await db
    .query("appointments")
    .withIndex("by_start_end", (q) =>
      q.gte("start", queryStart).lte("start", queryEnd),
    )
    .filter((q) => q.eq(q.field("practiceId"), practiceId))
    .collect();

  // Map to AppointmentContext
  return appointments.map((apt) => {
    const ctx: AppointmentContext = {
      _id: apt._id,
      end: apt.end,
      location: apt.locationId,
      start: apt.start,
    };
    if (apt.appointmentType != null) {
      ctx.type = apt.appointmentType;
    }
    if (apt.practitionerId != null) {
      ctx.doctor = apt.practitionerId;
    }
    return ctx;
  });
}
