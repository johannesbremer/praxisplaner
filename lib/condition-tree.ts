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

export interface ConditionTransportLeafNode {
  conditionType: ConditionType;
  nodeId: string;
  nodeType: "CONDITION";
  operator: ConditionOperator;
  scope?: Scope;
  valueIds?: string[];
  valueNumber?: number;
}

export interface ConditionTransportLogicalNode {
  childNodeIds: string[];
  nodeId: string;
  nodeType: "AND" | "NOT";
}

export type ConditionTreeNode = ConditionNode | LogicalNode;

export interface ConditionTreeTransport {
  nodes: ConditionTreeTransportNode[];
  rootNodeId: string;
}

export type ConditionTreeTransportNode =
  | ConditionTransportLeafNode
  | ConditionTransportLogicalNode;

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

export function parseConditionTreeTransport(value: unknown): ConditionTreeNode {
  if (!isRecord(value)) {
    throw new TypeError("conditionTree must be an object");
  }

  const rawRootNodeId = value["rootNodeId"];
  if (typeof rawRootNodeId !== "string" || rawRootNodeId.length === 0) {
    throw new TypeError("conditionTree.rootNodeId must be a non-empty string");
  }

  const rawNodes = value["nodes"];
  if (!Array.isArray(rawNodes)) {
    throw new TypeError("conditionTree.nodes must be an array");
  }

  const nodes = rawNodes.map((node, index) =>
    parseConditionTreeTransportNode(node, `conditionTree.nodes[${index}]`),
  );
  const nodesById = new Map<string, ConditionTreeTransportNode>();

  for (const node of nodes) {
    if (nodesById.has(node.nodeId)) {
      throw new TypeError(
        `conditionTree.nodes contains duplicate nodeId "${node.nodeId}"`,
      );
    }
    nodesById.set(node.nodeId, node);
  }

  const activeNodeIds = new Set<string>();
  const visitedNodeIds = new Set<string>();

  const buildNode = (nodeId: string, path: string): ConditionTreeNode => {
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new TypeError(`${path} references missing nodeId "${nodeId}"`);
    }
    if (activeNodeIds.has(nodeId)) {
      throw new TypeError(`${path} introduces a cycle at nodeId "${nodeId}"`);
    }
    if (visitedNodeIds.has(nodeId)) {
      throw new TypeError(
        `${path} reuses nodeId "${nodeId}" multiple times; expected a tree`,
      );
    }

    activeNodeIds.add(nodeId);

    if (node.nodeType === CONDITION_NODE_TYPE) {
      activeNodeIds.delete(nodeId);
      visitedNodeIds.add(nodeId);
      return {
        conditionType: node.conditionType,
        nodeType: CONDITION_NODE_TYPE,
        operator: node.operator,
        ...(node.scope === undefined ? {} : { scope: node.scope }),
        ...(node.valueIds === undefined ? {} : { valueIds: node.valueIds }),
        ...(node.valueNumber === undefined
          ? {}
          : { valueNumber: node.valueNumber }),
      };
    }

    const children = node.childNodeIds.map((childNodeId, index) =>
      buildNode(childNodeId, `${path}.childNodeIds[${index}]`),
    );

    activeNodeIds.delete(nodeId);
    visitedNodeIds.add(nodeId);

    return {
      children,
      nodeType: node.nodeType,
    };
  };

  const rootNode = buildNode(rawRootNodeId, "conditionTree.rootNodeId");

  if (visitedNodeIds.size !== nodesById.size) {
    throw new TypeError(
      "conditionTree.nodes contains unreachable nodes outside the root tree",
    );
  }

  return rootNode;
}

export function serializeConditionTreeTransport(
  value: ConditionTreeNode,
): ConditionTreeTransport {
  const nodes: ConditionTreeTransportNode[] = [];
  let nodeCounter = 0;

  const visit = (node: ConditionTreeNode): string => {
    const nodeId = `node-${nodeCounter}`;
    nodeCounter += 1;

    if (node.nodeType === CONDITION_NODE_TYPE) {
      nodes.push({
        conditionType: node.conditionType,
        nodeId,
        nodeType: CONDITION_NODE_TYPE,
        operator: node.operator,
        ...(node.scope === undefined ? {} : { scope: node.scope }),
        ...(node.valueIds === undefined ? {} : { valueIds: node.valueIds }),
        ...(node.valueNumber === undefined
          ? {}
          : { valueNumber: node.valueNumber }),
      });
      return nodeId;
    }

    const childNodeIds = node.children.map((child) => visit(child));
    nodes.push({
      childNodeIds,
      nodeId,
      nodeType: node.nodeType,
    });
    return nodeId;
  };

  return {
    nodes,
    rootNodeId: visit(value),
  };
}

function isConditionOperator(value: unknown): value is ConditionOperator {
  switch (value) {
    case "EQUALS":
    case "GREATER_THAN_OR_EQUAL":
    case "IS":
    case "IS_NOT":
    case "LESS_THAN":
    case "LESS_THAN_OR_EQUAL": {
      return true;
    }
    default: {
      return false;
    }
  }
}

function isConditionType(value: unknown): value is ConditionType {
  switch (value) {
    case "APPOINTMENT_TYPE":
    case "CLIENT_TYPE":
    case "CONCURRENT_COUNT":
    case "DAILY_CAPACITY":
    case "DATE_RANGE":
    case "DAY_OF_WEEK":
    case "DAYS_AHEAD":
    case "HOURS_AHEAD":
    case "LOCATION":
    case "PATIENT_AGE":
    case "PRACTITIONER":
    case "PRACTITIONER_TAG":
    case "TIME_RANGE": {
      return true;
    }
    default: {
      return false;
    }
  }
}

function isLogicalNodeType(value: unknown): value is LogicalNode["nodeType"] {
  return value === "AND" || value === "NOT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isScope(value: unknown): value is Scope {
  return (
    value === "location" || value === "practice" || value === "practitioner"
  );
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

function parseConditionTreeTransportNode(
  value: unknown,
  path: string,
): ConditionTreeTransportNode {
  if (!isRecord(value)) {
    throw new TypeError(`${path} must be an object`);
  }

  const rawNodeId = value["nodeId"];
  if (typeof rawNodeId !== "string" || rawNodeId.length === 0) {
    throw new TypeError(`${path}.nodeId must be a non-empty string`);
  }

  const rawNodeType = value["nodeType"];
  if (rawNodeType === CONDITION_NODE_TYPE) {
    return {
      ...parseConditionNode(value, path),
      nodeId: rawNodeId,
    };
  }

  if (!isLogicalNodeType(rawNodeType)) {
    throw new TypeError(`${path}.nodeType must be CONDITION, AND, or NOT`);
  }

  const rawChildNodeIds = value["childNodeIds"];
  if (!isStringArray(rawChildNodeIds)) {
    throw new TypeError(`${path}.childNodeIds must be an array of strings`);
  }

  return {
    childNodeIds: rawChildNodeIds,
    nodeId: rawNodeId,
    nodeType: rawNodeType,
  };
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
