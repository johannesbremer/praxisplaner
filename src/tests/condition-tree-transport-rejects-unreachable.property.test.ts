import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { parseConditionTreeTransport } from "../../lib/condition-tree";
import { assertProperty } from "./property-test-utils";

export function runProperty() {
  assertProperty(
    fc.property(
      fc.uniqueArray(fc.string({ maxLength: 12, minLength: 1 }), {
        maxLength: 2,
        minLength: 2,
      }),
      ([rootId, unreachableId]) => {
        expect(() =>
          parseConditionTreeTransport({
            nodes: [
              {
                conditionType: "DAY_OF_WEEK",
                nodeId: rootId,
                nodeType: "CONDITION",
                operator: "EQUALS",
                valueNumber: 1,
              },
              {
                conditionType: "DAY_OF_WEEK",
                nodeId: unreachableId,
                nodeType: "CONDITION",
                operator: "EQUALS",
                valueNumber: 2,
              },
            ],
            rootNodeId: rootId,
          }),
        ).toThrow(TypeError);
      },
    ),
    "condition tree rejects unreachable nodes",
  );
}

if (process.env["VITEST"]) {
  describe("condition tree transport unreachable node rejection property", () => {
    test("parseConditionTreeTransport rejects unreachable nodes", () => {
      expect.hasAssertions();
      runProperty();
    });
  });
}
