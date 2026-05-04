import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { parseConditionTreeTransport } from "../../lib/condition-tree";
import { assertAsyncProperty } from "./property-test-utils";

describe("condition tree transport shared child rejection property", () => {
  test("parseConditionTreeTransport rejects shared child reuse", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ maxLength: 12, minLength: 1 }), {
          maxLength: 4,
          minLength: 4,
        }),
        async ([rootId, leftId, rightId, childId]) => {
          await Promise.resolve();

          expect(() =>
            parseConditionTreeTransport({
              nodes: [
                {
                  childNodeIds: [leftId, rightId],
                  nodeId: rootId,
                  nodeType: "AND",
                },
                {
                  childNodeIds: [childId],
                  nodeId: leftId,
                  nodeType: "AND",
                },
                {
                  childNodeIds: [childId],
                  nodeId: rightId,
                  nodeType: "AND",
                },
                {
                  conditionType: "DAY_OF_WEEK",
                  nodeId: childId,
                  nodeType: "CONDITION",
                  operator: "EQUALS",
                  valueNumber: 1,
                },
              ],
              rootNodeId: rootId,
            }),
          ).toThrow(TypeError);
        },
      ),
      "condition tree rejects shared child reuse",
    );
  });
});
