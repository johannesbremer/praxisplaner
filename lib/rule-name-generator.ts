/**
 * Shared utility for generating human-readable German rule descriptions.
 * Used by both the UI (rule-builder.tsx) and tests (ruleEngine.test.ts).
 */

import type { ConditionTreeNode } from "../convex/ruleEngine";

// Condition types matching the UI
interface Condition {
  id: string;
  operator?: "GREATER_THAN_OR_EQUAL" | "IS" | "IS_NOT";
  type: ConditionType;
  valueIds?: string[];
  valueNumber?: null | number;
  // For concurrent/daily count conditions
  appointmentTypes?: null | string[];
  count?: null | number;
  scope?: "location" | "practice" | "practitioner" | null;
}

// UI supports a subset of backend condition types
type ConditionType =
  | "APPOINTMENT_TYPE"
  | "CONCURRENT_COUNT"
  | "DAILY_CAPACITY"
  | "DAY_OF_WEEK"
  | "DAYS_AHEAD"
  | "LOCATION"
  | "PRACTITIONER";

interface Entity {
  _id: string;
  name: string;
}

/**
 * Helper to format a list of names with proper German conjunction.
 */
function formatNames(names: string[], isAppointmentType = false): string {
  if (names.length === 0) {
    return "";
  }

  // For appointment types in same-day context
  if (isAppointmentType) {
    const formattedNames = names.map((name, index) => {
      const hasSpace = name.includes(" ");
      const quotedName = hasSpace ? `„${name}"` : name;
      const isLast = index === names.length - 1;
      return isLast ? `${quotedName}-Termine` : `${quotedName}-`;
    });

    if (formattedNames.length === 1) {
      return formattedNames[0] || "";
    }
    if (formattedNames.length === 2) {
      return `${formattedNames[0]} oder ${formattedNames[1]}`;
    }
    const lastItem = formattedNames[formattedNames.length - 1];
    const otherItems = formattedNames.slice(0, -1).join(", ");
    return `${otherItems} oder ${lastItem}`;
  }

  // For other types
  if (names.length === 1) {
    return names[0] || "";
  }
  if (names.length === 2) {
    return `${names[0]} oder ${names[1]}`;
  }
  const lastItem = names[names.length - 1];
  const otherItems = names.slice(0, -1).join(", ");
  return `${otherItems} oder ${lastItem}`;
}

/**
 * Helper function to convert numeric day of week to day name.
 */
export function dayNumberToName(dayNumber: number): string {
  const dayNames = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  return dayNames[dayNumber] ?? "SUNDAY";
}

/**
 * Helper function to convert day name to numeric day of week.
 */
export function dayNameToNumber(dayName: string): number {
  const dayMap: Record<string, number> = {
    FRIDAY: 5,
    MONDAY: 1,
    SATURDAY: 6,
    SUNDAY: 0,
    THURSDAY: 4,
    TUESDAY: 2,
    WEDNESDAY: 3,
  };
  return dayMap[dayName] ?? 0;
}

/**
 * Generate a human-readable German description from conditions array.
 */
export function generateRuleName(
  conditions: Condition[],
  appointmentTypes: Entity[],
  practitioners: Entity[],
  locations: Entity[],
): string {
  if (conditions.length === 0) {
    return "Keine Bedingungen";
  }

  const parts: string[] = ["Wenn"];

  for (const [index, condition] of conditions.entries()) {
    if (index > 0) {
      parts.push("und");
    }

    switch (condition.type) {
      case "APPOINTMENT_TYPE": {
        const names = (condition.valueIds
          ?.map((id) => appointmentTypes.find((at) => at._id === id)?.name)
          .filter(Boolean) ?? []) as string[];
        const isExclude = condition.operator === "IS_NOT";
        const formattedValue =
          names.length > 0 ? formatNames(names) : "[Termintyp]";
        parts.push(
          `der Termintyp ${isExclude ? "nicht" : ""} ${formattedValue} ist,`,
        );
        break;
      }
      case "CONCURRENT_COUNT": {
        const count = condition.count ?? 0;
        const atNames = (condition.appointmentTypes
          ?.map((id) => appointmentTypes.find((at) => at._id === id)?.name)
          .filter(Boolean) ?? []) as string[];
        const scopeLabel =
          condition.scope === "practice"
            ? "in der gesamten Praxis"
            : "am gleichen Standort";
        const formattedValue =
          atNames.length > 0 ? formatNames(atNames, true) : "[Termintyp]";
        parts.push(
          `gleichzeitig ${count} oder mehr ${formattedValue} ${scopeLabel} gebucht wurden,`,
        );
        break;
      }
      case "DAILY_CAPACITY": {
        const count = condition.count ?? 0;
        const atNames = (condition.appointmentTypes
          ?.map((id) => appointmentTypes.find((at) => at._id === id)?.name)
          .filter(Boolean) ?? []) as string[];
        const scopeLabel =
          condition.scope === "practice"
            ? "in der gesamten Praxis"
            : condition.scope === "location"
              ? "am gleichen Standort"
              : "beim gleichen Behandler";
        const formattedValue =
          atNames.length > 0 ? formatNames(atNames, true) : "[Termintyp]";
        parts.push(
          `am gleichen Tag ${count} oder mehr ${formattedValue} ${scopeLabel} gebucht wurden,`,
        );
        break;
      }
      case "DAY_OF_WEEK": {
        const dayLabels: Record<string, string> = {
          FRIDAY: "Freitag",
          MONDAY: "Montag",
          SATURDAY: "Samstag",
          SUNDAY: "Sonntag",
          THURSDAY: "Donnerstag",
          TUESDAY: "Dienstag",
          WEDNESDAY: "Mittwoch",
        };
        const names = (condition.valueIds
          ?.map((day) => dayLabels[day])
          .filter(Boolean) ?? []) as string[];
        const isExclude = condition.operator === "IS_NOT";
        const formattedValue =
          names.length > 0 ? formatNames(names) : "[Wochentag]";
        parts.push(`es ${isExclude ? "nicht" : ""} ${formattedValue} ist,`);
        break;
      }
      case "DAYS_AHEAD": {
        const days = condition.valueNumber || 0;
        const dayLabel =
          days === 1
            ? "Tag oder mehr entfernt ist,"
            : "Tage oder mehr entfernt ist,";
        parts.push(`der Termin ${days} ${dayLabel}`);
        break;
      }
      case "LOCATION": {
        const names = (condition.valueIds
          ?.map((id) => locations.find((l) => l._id === id)?.name)
          .filter(Boolean) ?? []) as string[];
        const isExclude = condition.operator === "IS_NOT";
        const formattedValue =
          names.length > 0 ? formatNames(names) : "[Standort]";
        parts.push(
          `der Standort ${isExclude ? "nicht" : ""} ${formattedValue} ist,`,
        );
        break;
      }
      case "PRACTITIONER": {
        const names = (condition.valueIds
          ?.map((id) => practitioners.find((p) => p._id === id)?.name)
          .filter(Boolean) ?? []) as string[];
        const isExclude = condition.operator === "IS_NOT";
        const formattedValue =
          names.length > 0 ? formatNames(names) : "[Behandler]";
        parts.push(
          `der Behandler ${isExclude ? "nicht" : ""} ${formattedValue} ist,`,
        );
        break;
      }
    }
  }

  parts.push("darf der Termin nicht vergeben werden.");

  return parts.join(" ");
}

/**
 * Helper to convert condition tree (from DB) to conditions array (for UI).
 */
export function conditionTreeToConditions(
  tree: ConditionTreeNode,
): Condition[] {
  const conditions: Condition[] = [];

  // Handle AND node with multiple conditions
  if (tree.nodeType === "AND") {
    for (const [index, child] of tree.children.entries()) {
      const condition = parseConditionNode(child, String(index));
      if (condition) {
        conditions.push(condition);
      }
    }
  } else if (tree.nodeType === "CONDITION") {
    // Single condition without AND wrapper
    const condition = parseConditionNode(tree, "0");
    if (condition) {
      conditions.push(condition);
    }
  }

  return conditions.length > 0
    ? conditions
    : [
        {
          id: "1",
          operator: "IS",
          type: "APPOINTMENT_TYPE",
          valueIds: [],
        },
      ];
}

/**
 * Helper to parse a single condition node from tree to Condition object.
 */
function parseConditionNode(
  node: ConditionTreeNode,
  id: string,
): Condition | null {
  // Only handle CONDITION nodes
  if (node.nodeType !== "CONDITION") {
    return null;
  }

  const { conditionType, operator, scope, valueIds, valueNumber } = node;

  // Filter out condition types not supported by the UI
  const supportedTypes: ConditionType[] = [
    "APPOINTMENT_TYPE",
    "CONCURRENT_COUNT",
    "DAILY_CAPACITY",
    "DAY_OF_WEEK",
    "DAYS_AHEAD",
    "LOCATION",
    "PRACTITIONER",
  ];

  if (!supportedTypes.includes(conditionType as ConditionType)) {
    // Skip unsupported condition types
    return null;
  }

  switch (conditionType) {
    case "APPOINTMENT_TYPE":
    case "LOCATION":
    case "PRACTITIONER": {
      // Handle filter types with valueIds
      return {
        id,
        operator: operator === "IS_NOT" ? "IS_NOT" : "IS",
        type: conditionType as ConditionType,
        valueIds: valueIds ?? [],
      };
    }
    case "CONCURRENT_COUNT": {
      return {
        appointmentTypes:
          (valueIds?.length ?? 0) > 0 ? (valueIds ?? null) : null,
        count: valueNumber ?? null,
        id,
        operator: "GREATER_THAN_OR_EQUAL",
        scope: scope ?? null,
        type: conditionType,
      };
    }
    case "DAILY_CAPACITY": {
      return {
        appointmentTypes:
          (valueIds?.length ?? 0) > 0 ? (valueIds ?? null) : null,
        count: valueNumber ?? null,
        id,
        operator: "GREATER_THAN_OR_EQUAL",
        scope: scope ?? null,
        type: conditionType,
      };
    }
    case "DAY_OF_WEEK": {
      // Convert valueNumber to day name
      const dayNumber = valueNumber ?? 0;
      const dayName = dayNumberToName(dayNumber);

      return {
        id,
        operator: operator === "IS_NOT" ? "IS_NOT" : "IS",
        type: conditionType,
        valueIds: [dayName],
      };
    }
    case "DAYS_AHEAD": {
      return {
        id,
        operator: "GREATER_THAN_OR_EQUAL",
        type: conditionType,
        valueNumber: valueNumber ?? null,
      };
    }
    default: {
      // Exhaustive check - should never reach here if supportedTypes check works
      return null;
    }
  }
}
