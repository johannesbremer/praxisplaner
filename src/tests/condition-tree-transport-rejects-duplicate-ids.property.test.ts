import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { parseConditionTreeTransport } from "../../lib/condition-tree";
import { assertProperty } from "./property-test-utils";

export function runProperty() {
  assertProperty(
    fc.property(fc.string({ maxLength: 12, minLength: 1 }), (id) => {
      expect(() =>
        parseConditionTreeTransport({
          nodes: [
            {
              conditionType: "DAY_OF_WEEK",
              nodeId: id,
              nodeType: "CONDITION",
              operator: "EQUALS",
              valueNumber: 1,
            },
            {
              conditionType: "DAY_OF_WEEK",
              nodeId: id,
              nodeType: "CONDITION",
              operator: "EQUALS",
              valueNumber: 2,
            },
          ],
          rootNodeId: id,
        }),
      ).toThrow(TypeError);
    }),
    "condition tree rejects duplicate ids",
  );
}

if (process.env["VITEST"]) {
  describe("condition tree transport duplicate id rejection property", () => {
    test("parseConditionTreeTransport rejects duplicate node IDs", () => {
      expect.hasAssertions();
      runProperty();
    });
  });
}
