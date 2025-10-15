import type { Id } from "../_generated/dataModel";
import type { ConditionTree } from "./types";

// ================================
// ERROR TYPES
// ================================

/**
 * Base error class for all rule engine errors
 */
export class RuleEngineError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;
  public readonly help: string | undefined;

  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>,
    help?: string,
  ) {
    super(message);
    this.name = "RuleEngineError";
    this.code = code;
    this.details = details ?? undefined;
    this.help = help ?? undefined;
  }

  /**
   * Format the error in a Rust-like style with colors and context.
   */
  override toString(): string {
    const lines: string[] = [];

    // Error header (like Rust's "error[E0308]")
    lines.push(`❌ error[${this.code}]: ${this.message}`);

    // Add details if present
    if (this.details && Object.keys(this.details).length > 0) {
      lines.push("", "📋 Details:");
      for (const [key, value] of Object.entries(this.details)) {
        const formattedValue =
          typeof value === "string" ? value : JSON.stringify(value, null, 2);
        lines.push(`   ${key}: ${formattedValue}`);
      }
    }

    // Add help message if present
    if (this.help) {
      lines.push("", `💡 Help: ${this.help}`);
    }

    return lines.join("\n");
  }
}

// ================================
// VALIDATION ERRORS
// ================================

export class ValidationError extends RuleEngineError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    help?: string,
  ) {
    super(message, "VALIDATION", details, help);
    this.name = "ValidationError";
  }
}

export class InvalidConditionTypeError extends ValidationError {
  constructor(
    conditionType: string,
    validTypes: readonly string[],
    path?: string,
  ) {
    super(
      `Unknown condition type: "${conditionType}"`,
      {
        allowed: validTypes,
        received: conditionType,
        ...(path && { path }),
      },
      `Valid condition types: ${validTypes.join(", ")}`,
    );
    this.name = "InvalidConditionTypeError";
  }
}

export class InvalidDurationError extends ValidationError {
  constructor(duration: string, examples?: readonly string[]) {
    super(
      `Invalid duration format: "${duration}"`,
      {
        expected: "Duration string like '35min', '2h', or '1h30min'",
        received: duration,
      },
      examples
        ? `Valid examples: ${examples.join(", ")}`
        : "Use formats like: 35min, 2h, 1h30min, 90min",
    );
    this.name = "InvalidDurationError";
  }
}

export class InvalidOperatorError extends ValidationError {
  constructor(operator: string, allowedOperators: readonly string[]) {
    super(
      `Unknown comparison operator: "${operator}"`,
      {
        allowed: allowedOperators,
        received: operator,
      },
      `Use one of: ${allowedOperators.join(", ")}`,
    );
    this.name = "InvalidOperatorError";
  }
}

export class MissingPropertyError extends ValidationError {
  constructor(
    property: string,
    entity: string,
    availableProperties?: readonly string[],
  ) {
    super(
      `Property "${property}" does not exist on ${entity}`,
      {
        entity,
        property,
        ...(availableProperties && { availableProperties }),
      },
      availableProperties
        ? `Available properties: ${availableProperties.join(", ")}`
        : `Check that the property name is spelled correctly`,
    );
    this.name = "MissingPropertyError";
  }
}

export class TypeMismatchError extends ValidationError {
  constructor(
    value: unknown,
    expectedType: string,
    operator: string,
    context?: string,
  ) {
    super(
      `Type mismatch: Cannot use operator "${operator}" with these types`,
      {
        expectedType,
        operator,
        value: JSON.stringify(value),
        valueType: typeof value,
        ...(context && { context }),
      },
      `The operator "${operator}" requires ${expectedType} values`,
    );
    this.name = "TypeMismatchError";
  }
}

// ================================
// RULE ERRORS
// ================================

export class PracticeMismatchError extends RuleEngineError {
  constructor(
    entityType: string,
    entityId: string,
    expectedPracticeId: Id<"practices">,
    actualPracticeId: Id<"practices">,
  ) {
    super(
      `${entityType} belongs to a different practice`,
      "PRACTICE_MISMATCH",
      {
        actualPracticeId,
        entityId,
        entityType,
        expectedPracticeId,
      },
      `This ${entityType.toLowerCase()} is associated with practice ${actualPracticeId}, but you're trying to use it with practice ${expectedPracticeId}`,
    );
    this.name = "PracticeMismatchError";
  }
}

export class RuleNotFoundError extends RuleEngineError {
  constructor(ruleId: Id<"rules">) {
    super(
      `Rule not found: ${ruleId}`,
      "RULE_NOT_FOUND",
      { ruleId },
      "Verify that the rule ID is correct and the rule hasn't been deleted",
    );
    this.name = "RuleNotFoundError";
  }
}

export class RuleSetMismatchError extends RuleEngineError {
  constructor(
    ruleId: Id<"rules">,
    expectedRuleSetId: Id<"ruleSets">,
    actualRuleSetId: Id<"ruleSets">,
  ) {
    super(
      `Rule belongs to a different rule set`,
      "RULESET_MISMATCH",
      {
        actualRuleSetId,
        expectedRuleSetId,
        ruleId,
      },
      "Make sure you're working with rules from the correct rule set. You may need to create or copy this rule to the target rule set.",
    );
    this.name = "RuleSetMismatchError";
  }
}

// ================================
// EVALUATION ERRORS
// ================================

export class EvaluationError extends RuleEngineError {
  constructor(
    message: string,
    ruleId?: Id<"rules">,
    ruleName?: string,
    conditionPath?: string,
  ) {
    super(
      message,
      "EVALUATION",
      {
        ...(ruleId && { ruleId }),
        ...(ruleName && { ruleName }),
        ...(conditionPath && { conditionPath }),
      },
      "Check the rule configuration and ensure all referenced entities exist",
    );
    this.name = "EvaluationError";
  }
}

export class SlotValidationError extends EvaluationError {
  constructor(reason: string, slot: unknown) {
    const slotDetails = {
      reason,
      slot: JSON.stringify(slot, null, 2),
    };
    super(`Invalid slot configuration: ${reason}`);
    // Override details after construction
    (this as { details: Record<string, unknown> | undefined }).details =
      slotDetails;
    (this as { help: string | undefined }).help =
      "Ensure the slot has valid start/end times, type, and duration fields";
  }
}

export class TimeRangeError extends EvaluationError {
  constructor(start: string, end: string, reason?: string) {
    const timeDetails = {
      end,
      start,
      ...(reason && { reason }),
    };
    super(
      `Invalid time range: ${reason || "start time must be before end time"}`,
    );
    // Override details after construction
    (this as { details: Record<string, unknown> | undefined }).details =
      timeDetails;
    (this as { help: string | undefined }).help =
      "Check that your time range is valid and properly formatted";
  }
}

// ================================
// DATA ERRORS
// ================================

export class DataIntegrityError extends RuleEngineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      "DATA_INTEGRITY",
      details,
      "This indicates a potential database inconsistency. Contact support if this persists.",
    );
    this.name = "DataIntegrityError";
  }
}

// ================================
// ERROR FORMATTING UTILITIES
// ================================

/**
 * Format a condition tree path for error messages (e.g., "AND[0].OR[1].Property").
 */
export function formatConditionPath(
  path: readonly (number | string)[],
): string {
  if (path.length === 0) {
    return "root";
  }

  const parts: string[] = [];
  for (const segment of path) {
    if (typeof segment === "number") {
      const lastIndex = parts.length - 1;
      if (lastIndex >= 0) {
        const lastPart = parts[lastIndex];
        if (lastPart !== undefined) {
          parts[lastIndex] = lastPart + `[${segment}]`;
        }
      }
    } else {
      parts.push(segment);
    }
  }
  return parts.join(".");
}

/**
 * Create a detailed error message for condition validation.
 */
export function createConditionValidationError(
  condition: unknown,
  path: readonly (number | string)[],
  reason: string,
): ValidationError {
  return new ValidationError(
    `Invalid condition at ${formatConditionPath(path)}: ${reason}`,
    {
      condition: JSON.stringify(condition, null, 2),
      path: formatConditionPath(path),
      reason,
    },
    "Review the condition structure and ensure all required fields are present and valid",
  );
}

/**
 * Validate condition tree structure and throw descriptive errors.
 */
export function validateConditionTree(
  condition: unknown,
  path: readonly (number | string)[] = [],
): asserts condition is ConditionTree {
  if (!condition || typeof condition !== "object") {
    throw createConditionValidationError(
      condition,
      path,
      "Condition must be an object",
    );
  }

  const cond = condition as Record<string, unknown>;

  if (!("type" in cond) || typeof cond["type"] !== "string") {
    throw createConditionValidationError(
      condition,
      path,
      'Condition must have a "type" field',
    );
  }

  const condType = cond["type"];

  const validTypes = [
    "Property",
    "Count",
    "TimeRangeFree",
    "Adjacent",
    "AND",
    "OR",
    "NOT",
  ];

  if (!validTypes.includes(condType)) {
    throw new InvalidConditionTypeError(
      condType,
      validTypes,
      formatConditionPath(path),
    );
  }

  // Validate specific condition types
  switch (condType) {
    case "Adjacent": {
      if (
        !("direction" in cond) ||
        (cond["direction"] !== "before" && cond["direction"] !== "after")
      ) {
        throw createConditionValidationError(
          condition,
          path,
          'Adjacent condition must have "direction" field set to "before" or "after"',
        );
      }
      if (!("filter" in cond) || typeof cond["filter"] !== "object") {
        throw createConditionValidationError(
          condition,
          path,
          'Adjacent condition must have a "filter" object',
        );
      }
      break;
    }

    case "AND":
    // Falls through to OR case
    case "OR": {
      if (!("children" in cond) || !Array.isArray(cond["children"])) {
        throw createConditionValidationError(
          condition,
          path,
          `${condType} condition must have a "children" array`,
        );
      }
      const children = cond["children"] as unknown[];
      if (children.length === 0) {
        throw createConditionValidationError(
          condition,
          path,
          `${condType} condition must have at least one child`,
        );
      }
      // Recursively validate children
      for (const [index, child] of children.entries()) {
        validateConditionTree(child, [...path, condType, index]);
      }
      break;
    }

    case "Count": {
      if (!("filter" in cond) || typeof cond["filter"] !== "object") {
        throw createConditionValidationError(
          condition,
          path,
          'Count condition must have a "filter" object',
        );
      }
      if (!("op" in cond) || typeof cond["op"] !== "string") {
        throw createConditionValidationError(
          condition,
          path,
          'Count condition must have an "op" field',
        );
      }
      if (!("value" in cond) || typeof cond["value"] !== "number") {
        throw createConditionValidationError(
          condition,
          path,
          'Count condition must have a numeric "value" field',
        );
      }
      break;
    }

    case "NOT": {
      if (!("child" in cond)) {
        throw createConditionValidationError(
          condition,
          path,
          'NOT condition must have a "child" field',
        );
      }
      // Recursively validate child
      validateConditionTree(cond["child"], [...path, "NOT"]);
      break;
    }
    case "Property": {
      if (!("attr" in cond) || typeof cond["attr"] !== "string") {
        throw createConditionValidationError(
          condition,
          path,
          'Property condition must have an "attr" field',
        );
      }
      if (
        !("entity" in cond) ||
        (cond["entity"] !== "Slot" && cond["entity"] !== "Context")
      ) {
        throw createConditionValidationError(
          condition,
          path,
          'Property condition must have "entity" field set to "Slot" or "Context"',
        );
      }
      if (!("op" in cond) || typeof cond["op"] !== "string") {
        throw createConditionValidationError(
          condition,
          path,
          'Property condition must have an "op" field',
        );
      }
      if (!("value" in cond)) {
        throw createConditionValidationError(
          condition,
          path,
          'Property condition must have a "value" field',
        );
      }
      break;
    }

    case "TimeRangeFree": {
      if (!("duration" in cond) || typeof cond["duration"] !== "string") {
        throw createConditionValidationError(
          condition,
          path,
          'TimeRangeFree condition must have a "duration" string',
        );
      }
      if (
        !("start" in cond) ||
        (cond["start"] !== "Slot.start" && cond["start"] !== "Slot.end")
      ) {
        throw createConditionValidationError(
          condition,
          path,
          'TimeRangeFree condition must have "start" field set to "Slot.start" or "Slot.end"',
        );
      }
      break;
    }
  }
}

/**
 * Pretty print an error for console/logging.
 */
export function formatError(error: unknown): string {
  if (error instanceof RuleEngineError) {
    return error.toString();
  }

  if (error instanceof Error) {
    return `❌ Error: ${error.message}\n   ${error.stack || ""}`;
  }

  return `❌ Unknown error: ${String(error)}`;
}
