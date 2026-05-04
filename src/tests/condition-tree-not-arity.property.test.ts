import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  parseConditionTreeNode,
  parseConditionTreeTransport,
} from "../../lib/condition-tree";
import { assertAsyncProperty } from "./property-test-utils";

describe("condition tree NOT arity property", () => {
  test("parsers reject NOT nodes without exactly one child", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.array(fc.constant("child"), { maxLength: 4 }),
        async (children) => {
          fc.pre(children.length !== 1);
          await Promise.resolve();

          expect(() =>
            parseConditionTreeNode({
              children: children.map(() => ({
                conditionType: "DAY_OF_WEEK",
                nodeType: "CONDITION",
                operator: "EQUALS",
                valueNumber: 1,
              })),
              nodeType: "NOT",
            }),
          ).toThrow(TypeError);

          expect(() =>
            parseConditionTreeTransport({
              nodes: [
                {
                  childNodeIds: children.map((_, index) => `child-${index}`),
                  nodeId: "root",
                  nodeType: "NOT",
                },
                ...children.map((_, index) => ({
                  conditionType: "DAY_OF_WEEK",
                  nodeId: `child-${index}`,
                  nodeType: "CONDITION",
                  operator: "EQUALS",
                  valueNumber: 1,
                })),
              ],
              rootNodeId: "root",
            }),
          ).toThrow(TypeError);
        },
      ),
      "condition tree rejects invalid NOT arity",
    );
  });
});
