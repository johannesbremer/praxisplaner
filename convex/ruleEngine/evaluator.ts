import type { DatabaseReader } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type {
  ConditionTree,
  SlotContext,
  AppointmentContext,
  EvaluationContext,
  RuleEvaluationResult,
  SchedulingRule,
  PropertyCondition,
  CountCondition,
  TimeRangeFreeCondition,
  AdjacentCondition,
  AndCondition,
  OrCondition,
  NotCondition,
} from "./types";

// ================================
// DURATION PARSING
// ================================

/**
 * Parse duration string to milliseconds
 * Supports: "35min", "2h", "1h30min"
 */
export function parseDuration(duration: string): number {
  const parts = duration.match(/(\d+)(h|min)/g);
  if (!parts) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  let totalMs = 0;
  for (const part of parts) {
    const match = part.match(/(\d+)(h|min)/);
    if (!match || !match[1]) {
      continue;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (unit === "h") {
      totalMs += value * 60 * 60 * 1000;
    } else if (unit === "min") {
      totalMs += value * 60 * 1000;
    }
  }

  return totalMs;
}

// ================================
// COMPARISON OPERATORS
// ================================

/**
 * Compare two values using an operator
 */
function compareValues(
  left: string | number,
  op: string,
  right: string | number | ReadonlyArray<string>,
): boolean {
  switch (op) {
    case "=":
      return left === right;
    case "!=":
      return left !== right;
    case "<":
      return (
        typeof left === "number" && typeof right === "number" && left < right
      );
    case ">":
      return (
        typeof left === "number" && typeof right === "number" && left > right
      );
    case "<=":
      return (
        typeof left === "number" && typeof right === "number" && left <= right
      );
    case ">=":
      return (
        typeof left === "number" && typeof right === "number" && left >= right
      );
    case "IN":
      return Array.isArray(right) && right.includes(String(left));
    case "NOT_IN":
      return Array.isArray(right) && !right.includes(String(left));
    default:
      throw new Error(`Unknown operator: ${op}`);
  }
}

// ================================
// TIME UTILITIES
// ================================

/**
 * Check if two time ranges overlap
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
 * Add milliseconds to an ISO datetime string
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
 * Evaluate a Property condition
 */
function evaluateProperty(
  condition: PropertyCondition,
  slot: SlotContext,
  context: EvaluationContext,
): boolean {
  const entity = condition.entity === "Slot" ? slot : context;
  const value = entity[condition.attr];

  if (value === undefined) {
    return false;
  }

  return compareValues(value, condition.op, condition.value);
}

/**
 * Evaluate a Count condition
 */
async function evaluateCount(
  condition: CountCondition,
  slot: SlotContext,
  appointments: ReadonlyArray<AppointmentContext>,
): Promise<boolean> {
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
 * Evaluate a TimeRangeFree condition
 */
async function evaluateTimeRangeFree(
  _db: DatabaseReader,
  condition: TimeRangeFreeCondition,
  slot: SlotContext,
  appointments: ReadonlyArray<AppointmentContext>,
): Promise<boolean> {
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
 * Evaluate an Adjacent condition
 */
async function evaluateAdjacent(
  _db: DatabaseReader,
  condition: AdjacentCondition,
  slot: SlotContext,
  appointments: ReadonlyArray<AppointmentContext>,
): Promise<boolean> {
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
 * Recursively evaluate a condition tree
 */
export async function evaluateCondition(
  db: DatabaseReader,
  condition: ConditionTree,
  slot: SlotContext,
  appointments: ReadonlyArray<AppointmentContext>,
  context: EvaluationContext,
): Promise<boolean> {
  switch (condition.type) {
    case "Property":
      return evaluateProperty(condition, slot, context);

    case "Count":
      return await evaluateCount(condition, slot, appointments);

    case "TimeRangeFree":
      return await evaluateTimeRangeFree(db, condition, slot, appointments);

    case "Adjacent":
      return await evaluateAdjacent(db, condition, slot, appointments);

    case "AND": {
      const andCondition = condition as AndCondition;
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

    case "OR": {
      const orCondition = condition as OrCondition;
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

    case "NOT": {
      const notCondition = condition as NotCondition;
      const result = await evaluateCondition(
        db,
        notCondition.child,
        slot,
        appointments,
        context,
      );
      return !result;
    }

    default:
      throw new Error(
        `Unknown condition type: ${(condition as ConditionTree).type}`,
      );
  }
}

// ================================
// RULE EVALUATION
// ================================

/**
 * Evaluate all rules for a slot and return the first matching result
 * Rules are evaluated in priority order (lower number = higher priority)
 */
export async function evaluateRules(
  db: DatabaseReader,
  rules: ReadonlyArray<SchedulingRule>,
  slot: SlotContext,
  appointments: ReadonlyArray<AppointmentContext>,
  context: EvaluationContext,
): Promise<RuleEvaluationResult> {
  // Sort rules by priority
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

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
          ruleId: rule._id,
          ruleName: rule.name,
          message: rule.message,
        };
      } else {
        return {
          action: "ALLOW",
          ruleId: rule._id,
          ruleName: rule.name,
          message: rule.message,
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
 * Fetch all appointments that might be relevant for rule evaluation
 * This includes appointments that overlap with or are adjacent to the slot
 */
export async function fetchRelevantAppointments(
  db: DatabaseReader,
  slot: SlotContext,
  practiceId: Id<"practices">,
  maxLookAheadMs: number = 4 * 60 * 60 * 1000, // 4 hours
): Promise<Array<AppointmentContext>> {
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
      start: apt.start,
      end: apt.end,
    };
    if (apt.appointmentType !== null && apt.appointmentType !== undefined) {
      ctx.type = apt.appointmentType;
    }
    if (apt.practitionerId !== null && apt.practitionerId !== undefined) {
      ctx.doctor = apt.practitionerId;
    }
    if (apt.locationId !== null && apt.locationId !== undefined) {
      ctx.location = apt.locationId;
    }
    return ctx;
  });
}
