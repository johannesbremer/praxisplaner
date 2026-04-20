import { describe, expect, test } from "vitest";

import { regex } from "../../lib/arkregex";
import {
  type ConditionTreeNode,
  parseConditionTreeTransport,
  serializeConditionTreeTransport,
} from "../../lib/condition-tree";

const REUSED_NODE_ID_REGEX = regex.as("reuses nodeId");
const UNREACHABLE_NODES_REGEX = regex.as("unreachable nodes");

describe("condition tree transport", () => {
  test("round-trips recursive trees through the flat transport", () => {
    const conditionTree: ConditionTreeNode = {
      children: [
        {
          conditionType: "APPOINTMENT_TYPE",
          nodeType: "CONDITION",
          operator: "IS",
          valueIds: ["appointment-type-1"],
        },
        {
          children: [
            {
              conditionType: "DAY_OF_WEEK",
              nodeType: "CONDITION",
              operator: "IS",
              valueNumber: 1,
            },
          ],
          nodeType: "NOT",
        },
      ],
      nodeType: "AND",
    };

    const transport = serializeConditionTreeTransport(conditionTree);

    expect(parseConditionTreeTransport(transport)).toEqual(conditionTree);
  });

  test("rejects graphs that reuse the same node multiple times", () => {
    expect(() =>
      parseConditionTreeTransport({
        nodes: [
          {
            childNodeIds: ["shared-node", "shared-node"],
            nodeId: "root",
            nodeType: "AND",
          },
          {
            conditionType: "DAY_OF_WEEK",
            nodeId: "shared-node",
            nodeType: "CONDITION",
            operator: "IS",
            valueNumber: 1,
          },
        ],
        rootNodeId: "root",
      }),
    ).toThrow(REUSED_NODE_ID_REGEX);
  });

  test("rejects unreachable nodes outside the root tree", () => {
    expect(() =>
      parseConditionTreeTransport({
        nodes: [
          {
            childNodeIds: ["leaf"],
            nodeId: "root",
            nodeType: "AND",
          },
          {
            conditionType: "DAY_OF_WEEK",
            nodeId: "leaf",
            nodeType: "CONDITION",
            operator: "IS",
            valueNumber: 1,
          },
          {
            conditionType: "LOCATION",
            nodeId: "orphan",
            nodeType: "CONDITION",
            operator: "IS",
            valueIds: ["location-1"],
          },
        ],
        rootNodeId: "root",
      }),
    ).toThrow(UNREACHABLE_NODES_REGEX);
  });
});
