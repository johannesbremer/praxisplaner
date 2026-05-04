import fc, { type Arbitrary } from "fast-check";

import type {
  ConditionOperator,
  ConditionTreeNode,
  ConditionTreeTransportNode,
  ConditionType,
  Scope,
} from "../../lib/condition-tree";

import {
  CONDITION_OPERATORS,
  CONDITION_TYPES,
  SCOPES,
} from "../../lib/condition-tree";

const conditionTypeArbitrary = fc.constantFrom<ConditionType>(
  ...CONDITION_TYPES,
);
const operatorArbitrary = fc.constantFrom<ConditionOperator>(
  ...CONDITION_OPERATORS,
);
const scopeArbitrary = fc.option(fc.constantFrom<Scope>(...SCOPES), {
  nil: undefined,
});
const valueIdsArbitrary = fc.option(
  fc.array(fc.string({ maxLength: 12, minLength: 1 }), { maxLength: 4 }),
  { nil: undefined },
);
const valueNumberArbitrary = fc.option(fc.integer({ max: 500, min: -50 }), {
  nil: undefined,
});

export function collectReachableNodeIds(
  rootNodeId: string,
  nodesById: ReadonlyMap<string, ConditionTreeTransportNode>,
): Set<string> {
  const reachable = new Set<string>();
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) {
      return;
    }
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`Missing serialized node ${nodeId}.`);
    }
    reachable.add(nodeId);
    if (node.nodeType !== "CONDITION") {
      for (const childNodeId of node.childNodeIds) {
        visit(childNodeId);
      }
    }
  };

  visit(rootNodeId);
  return reachable;
}

export function conditionTreeArbitrary(
  depth: number,
): Arbitrary<ConditionTreeNode> {
  const conditionNode = fc
    .tuple(
      conditionTypeArbitrary,
      operatorArbitrary,
      scopeArbitrary,
      valueIdsArbitrary,
      valueNumberArbitrary,
    )
    .map(
      ([
        conditionType,
        operator,
        scope,
        valueIds,
        valueNumber,
      ]): ConditionTreeNode => ({
        conditionType,
        nodeType: "CONDITION",
        operator,
        ...(scope === undefined ? {} : { scope }),
        ...(valueIds === undefined ? {} : { valueIds }),
        ...(valueNumber === undefined ? {} : { valueNumber }),
      }),
    );

  if (depth <= 0) {
    return conditionNode;
  }

  const child = conditionTreeArbitrary(depth - 1);
  const logicalNode = fc
    .tuple(
      fc.constantFrom("AND", "NOT"),
      fc.array(child, { maxLength: 3, minLength: 1 }),
    )
    .map(
      ([nodeType, children]): ConditionTreeNode => ({
        children,
        nodeType,
      }),
    );

  return fc.oneof(conditionNode, logicalNode);
}
