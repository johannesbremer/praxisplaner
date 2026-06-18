/**
 * Shared utility for generating human-readable German rule descriptions.
 * Used by both the UI (rule-builder.tsx) and tests (ruleEngine.test.ts).
 */

import type { ConditionTreeNode, ConditionType } from "./condition-tree";

export type AdvanceTimeUnit = "days" | "hours" | "minutes";

// Condition types matching the UI
interface Condition {
  advanceUnit?: AdvanceTimeUnit | null;
  id: string;
  operator?:
    | "GREATER_THAN"
    | "GREATER_THAN_OR_EQUAL"
    | "IS"
    | "IS_NOT"
    | "LESS_THAN";
  type: ConditionType;
  valueIds?: string[];
  valueNumber?: null | number;
  // For concurrent/daily count conditions
  appointmentTypes?: null | string[];
  count?: null | number;
  scope?: "location" | "practice" | "practitioner" | null;
}

interface Entity {
  _id: string;
  lineageKey?: string;
  name: string;
}

function createEntityNameResolver(entities: Entity[]) {
  const nameByReference = new Map<string, string>();

  for (const entity of entities) {
    nameByReference.set(entity._id, entity.name);
    if (entity.lineageKey) {
      nameByReference.set(entity.lineageKey, entity.name);
    }
  }

  return (reference: string) => nameByReference.get(reference);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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

  const resolveAppointmentTypeName = createEntityNameResolver(appointmentTypes);
  const resolvePractitionerName = createEntityNameResolver(practitioners);
  const resolveLocationName = createEntityNameResolver(locations);
  const parts: string[] = ["Wenn"];

  for (const [index, condition] of conditions.entries()) {
    if (index > 0) {
      parts.push("und");
    }

    switch (condition.type) {
      case "APPOINTMENT_TYPE": {
        const names =
          condition.valueIds
            ?.map((id) => resolveAppointmentTypeName(id))
            .filter(isDefined) ?? [];
        const isExclude = condition.operator === "IS_NOT";
        const formattedValue =
          names.length > 0 ? formatNames(names) : "[Termintyp]";
        parts.push(
          `der Termintyp ${isExclude ? "nicht" : ""} ${formattedValue} ist,`,
        );
        break;
      }
      case "CLIENT_TYPE": {
        const names = condition.valueIds ?? [];
        const isExclude = condition.operator === "IS_NOT";
        const formattedValue =
          names.length > 0 ? formatNames(names) : "[Patiententyp]";
        parts.push(
          `der Patiententyp ${isExclude ? "nicht " : ""}${formattedValue} ist,`,
        );
        break;
      }
      case "CONCURRENT_COUNT": {
        const count = condition.count ?? 0;
        const atNames =
          condition.appointmentTypes
            ?.map((id) => resolveAppointmentTypeName(id))
            .filter(isDefined) ?? [];
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
        const atNames =
          condition.appointmentTypes
            ?.map((id) => resolveAppointmentTypeName(id))
            .filter(isDefined) ?? [];
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
      case "DATE_RANGE": {
        const values = condition.valueIds ?? [];
        const startDate = values[0] ? formatIsoDate(values[0]) : "[Start]";
        const endDate = values[1] ? formatIsoDate(values[1]) : "[Ende]";
        const isExclude = condition.operator === "IS_NOT";
        parts.push(
          `das Datum ${isExclude ? "nicht " : ""}zwischen ${startDate} und ${endDate} liegt,`,
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
        const names =
          condition.valueIds?.map((day) => dayLabels[day]).filter(isDefined) ??
          [];
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
      case "HOURS_AHEAD": {
        const hours = condition.valueNumber || 0;
        const hourLabel =
          hours === 1 ? "Stunde entfernt ist," : "Stunden entfernt ist,";
        parts.push(`der Termin weniger als ${hours} ${hourLabel}`);
        break;
      }
      case "LOCATION": {
        const names =
          condition.valueIds
            ?.map((id) => resolveLocationName(id))
            .filter(isDefined) ?? [];
        const isExclude = condition.operator === "IS_NOT";
        const formattedValue =
          names.length > 0 ? formatNames(names) : "[Standort]";
        parts.push(
          `der Standort ${isExclude ? "nicht" : ""} ${formattedValue} ist,`,
        );
        break;
      }
      case "MINIMUM_ADVANCE_TIME": {
        const amount = condition.valueNumber || 0;
        const unit = condition.advanceUnit ?? "hours";
        const unitLabel = formatAdvanceTimeUnit(amount, unit);
        if (condition.operator === "GREATER_THAN") {
          parts.push(
            `der Termin mehr als ${amount} ${unitLabel} in der Zukunft liegt,`,
          );
        } else {
          parts.push(
            `der Termin weniger als ${amount} ${unitLabel} in der Zukunft liegt,`,
          );
        }
        break;
      }
      case "PATIENT_AGE": {
        const age = condition.valueNumber ?? 0;
        if (condition.operator === "LESS_THAN") {
          parts.push(`der Patient jünger als ${age} Jahre alt ist,`);
        } else {
          parts.push(`der Patient ${age} Jahre oder älter ist,`);
        }
        break;
      }
      case "PRACTITIONER": {
        const names =
          condition.valueIds
            ?.map((id) => resolvePractitionerName(id))
            .filter(isDefined) ?? [];
        const isExclude = condition.operator === "IS_NOT";
        const formattedValue =
          names.length > 0 ? formatNames(names) : "[Behandler]";
        parts.push(
          `der Behandler ${isExclude ? "nicht" : ""} ${formattedValue} ist,`,
        );
        break;
      }
      case "TIME_RANGE": {
        const values = condition.valueIds ?? [];
        const startTime = values[0] ?? "[Start]";
        const endTime = values[1] ?? "[Ende]";
        const isExclude = condition.operator === "IS_NOT";
        parts.push(
          `die Uhrzeit ${isExclude ? "nicht " : ""}zwischen ${startTime} und ${endTime} liegt,`,
        );
        break;
      }
      default: {
        assertNever(condition.type);
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

  const visit = (node: ConditionTreeNode, path: string) => {
    if (node.nodeType === "CONDITION") {
      conditions.push(parseConditionNode(node, path));
      return;
    }
    if (node.nodeType === "NOT") {
      throw new Error(
        "NOT-Regelbäume können nicht als flache Bedingungen dargestellt werden",
      );
    }

    for (const [index, child] of node.children.entries()) {
      visit(child, `${path}.${index}`);
    }
  };

  visit(tree, "0");

  if (conditions.length === 0) {
    throw new Error("Regelbaum enthaelt keine Bedingungen");
  }

  return conditions;
}

/**
 * Helper to parse a single condition node from tree to Condition object.
 */
function assertNever(value: never): never {
  throw new Error(`Unsupported condition type: ${String(value)}`);
}

function formatAdvanceTimeUnit(amount: number, unit: AdvanceTimeUnit): string {
  switch (unit) {
    case "days": {
      return amount === 1 ? "Tag" : "Tage";
    }
    case "hours": {
      return amount === 1 ? "Stunde" : "Stunden";
    }
    case "minutes": {
      return amount === 1 ? "Minute" : "Minuten";
    }
    default: {
      return assertNever(unit);
    }
  }
}

function formatIsoDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function parseAdvanceTimeUnit(value: string | undefined): AdvanceTimeUnit {
  switch (value) {
    case "days":
    case "hours":
    case "minutes": {
      return value;
    }
    default: {
      return "hours";
    }
  }
}

function parseConditionNode(
  node: Extract<ConditionTreeNode, { nodeType: "CONDITION" }>,
  id: string,
): Condition {
  const { conditionType, operator, scope, valueIds, valueNumber } = node;

  switch (conditionType) {
    case "APPOINTMENT_TYPE":
    case "LOCATION":
    case "PRACTITIONER": {
      // Handle filter types with valueIds
      return {
        id,
        operator: operator === "IS_NOT" ? "IS_NOT" : "IS",
        type: conditionType,
        valueIds: valueIds ?? [],
      };
    }
    case "CLIENT_TYPE":
    case "DATE_RANGE":
    case "TIME_RANGE": {
      return {
        id,
        operator: operator === "IS_NOT" ? "IS_NOT" : "IS",
        type: conditionType,
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
    case "HOURS_AHEAD": {
      return {
        id,
        operator: "LESS_THAN",
        type: conditionType,
        valueNumber: valueNumber ?? null,
      };
    }
    case "MINIMUM_ADVANCE_TIME": {
      return {
        advanceUnit: parseAdvanceTimeUnit(valueIds?.[0]),
        id,
        operator: operator === "GREATER_THAN" ? "GREATER_THAN" : "LESS_THAN",
        type: conditionType,
        valueNumber: valueNumber ?? null,
      };
    }
    case "PATIENT_AGE": {
      return {
        id,
        operator:
          operator === "LESS_THAN" ? "LESS_THAN" : "GREATER_THAN_OR_EQUAL",
        type: conditionType,
        valueNumber: valueNumber ?? null,
      };
    }
    default: {
      return assertNever(conditionType);
    }
  }
}
