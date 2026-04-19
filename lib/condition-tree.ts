export interface ConditionNode {
  conditionType: ConditionType;
  nodeType: "CONDITION";
  operator: ConditionOperator;
  scope?: Scope;
  valueIds?: string[];
  valueNumber?: number;
}

export type ConditionOperator =
  | "EQUALS"
  | "GREATER_THAN_OR_EQUAL"
  | "IS"
  | "IS_NOT"
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUAL";

export type ConditionTreeNode = ConditionNode | LogicalNode;

export type ConditionType =
  | "APPOINTMENT_TYPE"
  | "CLIENT_TYPE"
  | "CONCURRENT_COUNT"
  | "DAILY_CAPACITY"
  | "DATE_RANGE"
  | "DAY_OF_WEEK"
  | "DAYS_AHEAD"
  | "HOURS_AHEAD"
  | "LOCATION"
  | "PATIENT_AGE"
  | "PRACTITIONER"
  | "PRACTITIONER_TAG"
  | "TIME_RANGE";

export interface LogicalNode {
  children: ConditionTreeNode[];
  nodeType: "AND" | "NOT";
}

export type Scope = "location" | "practice" | "practitioner";

const CONDITION_NODE_TYPE = "CONDITION";
export const CONDITION_OPERATORS = [
  "EQUALS",
  "GREATER_THAN_OR_EQUAL",
  "IS",
  "IS_NOT",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
] as const satisfies readonly ConditionOperator[];
export const CONDITION_TYPES = [
  "APPOINTMENT_TYPE",
  "CLIENT_TYPE",
  "CONCURRENT_COUNT",
  "DAILY_CAPACITY",
  "DATE_RANGE",
  "DAY_OF_WEEK",
  "DAYS_AHEAD",
  "HOURS_AHEAD",
  "LOCATION",
  "PATIENT_AGE",
  "PRACTITIONER",
  "PRACTITIONER_TAG",
  "TIME_RANGE",
] as const satisfies readonly ConditionType[];
export const LOGICAL_NODE_TYPES = [
  "AND",
  "NOT",
] as const satisfies readonly LogicalNode["nodeType"][];
export const SCOPES = [
  "location",
  "practice",
  "practitioner",
] as const satisfies readonly Scope[];

export function isConditionNode(
  node: ConditionTreeNode,
): node is ConditionNode {
  return node.nodeType === CONDITION_NODE_TYPE;
}

export function isLogicalNode(node: ConditionTreeNode): node is LogicalNode {
  return isLogicalNodeType(node.nodeType);
}

export function parseConditionTreeNode(value: unknown): ConditionTreeNode {
  return parseConditionTreeNodeAtPath(value, "conditionTree");
}

function isConditionOperator(value: unknown): value is ConditionOperator {
  return (
    typeof value === "string" &&
    CONDITION_OPERATORS.includes(value as ConditionOperator)
  );
}

function isConditionType(value: unknown): value is ConditionType {
  return (
    typeof value === "string" &&
    CONDITION_TYPES.includes(value as ConditionType)
  );
}

function isLogicalNodeType(value: unknown): value is LogicalNode["nodeType"] {
  return (
    typeof value === "string" &&
    LOGICAL_NODE_TYPES.includes(value as LogicalNode["nodeType"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isScope(value: unknown): value is Scope {
  return typeof value === "string" && SCOPES.includes(value as Scope);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function parseConditionNode(
  value: Record<string, unknown>,
  path: string,
): ConditionNode {
  const rawConditionType = value["conditionType"];
  if (!isConditionType(rawConditionType)) {
    throw new TypeError(`${path}.conditionType is invalid`);
  }

  const rawOperator = value["operator"];
  if (!isConditionOperator(rawOperator)) {
    throw new TypeError(`${path}.operator is invalid`);
  }

  const rawScope = value["scope"];
  if (rawScope !== undefined && !isScope(rawScope)) {
    throw new TypeError(`${path}.scope is invalid`);
  }

  const rawValueIds = value["valueIds"];
  if (rawValueIds !== undefined && !isStringArray(rawValueIds)) {
    throw new TypeError(`${path}.valueIds must be an array of strings`);
  }

  const rawValueNumber = value["valueNumber"];
  if (rawValueNumber !== undefined && typeof rawValueNumber !== "number") {
    throw new TypeError(`${path}.valueNumber must be a number`);
  }

  return {
    conditionType: rawConditionType,
    nodeType: CONDITION_NODE_TYPE,
    operator: rawOperator,
    ...(rawScope === undefined ? {} : { scope: rawScope }),
    ...(rawValueIds === undefined ? {} : { valueIds: rawValueIds }),
    ...(rawValueNumber === undefined ? {} : { valueNumber: rawValueNumber }),
  };
}

function parseConditionTreeNodeAtPath(
  value: unknown,
  path: string,
): ConditionTreeNode {
  if (!isRecord(value)) {
    throw new TypeError(`${path} must be an object`);
  }

  const rawNodeType = value["nodeType"];
  if (rawNodeType === CONDITION_NODE_TYPE) {
    return parseConditionNode(value, path);
  }

  if (!isLogicalNodeType(rawNodeType)) {
    throw new TypeError(`${path}.nodeType must be CONDITION, AND, or NOT`);
  }

  return parseLogicalNode(value, path, rawNodeType);
}

function parseLogicalNode(
  value: Record<string, unknown>,
  path: string,
  nodeType: LogicalNode["nodeType"],
): LogicalNode {
  const rawChildren = value["children"];
  if (!Array.isArray(rawChildren)) {
    throw new TypeError(`${path}.children must be an array`);
  }

  return {
    children: rawChildren.map((child, index) =>
      parseConditionTreeNodeAtPath(child, `${path}.children[${index}]`),
    ),
    nodeType,
  };
}
